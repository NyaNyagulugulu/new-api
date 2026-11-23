/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { getMemorySettings, saveUserMemories, sendChatCompletion } from '../api'
import {
  buildMemoryExtractionMessages,
  getMemoryExtractionResponseContent,
  isMemoryExtractionMessage,
  parseExtractedMemories,
} from '../lib'
import type { ChatSession, MemorySettings, PlaygroundConfig } from '../types'

type UseLongTermMemoryParams = {
  config: PlaygroundConfig
  sessions: ChatSession[]
  settings?: MemorySettings
}

export function useMemorySettings() {
  const { data } = useQuery({
    queryKey: ['playground-memory-settings'],
    queryFn: getMemorySettings,
    staleTime: 60_000,
    meta: { errorToast: false },
  })
  return data
}

export function useLongTermMemoryReflection({
  config,
  sessions,
  settings,
}: UseLongTermMemoryParams) {
  const completedCountsRef = useRef<Map<string, number>>(new Map())
  const initialisedRef = useRef(false)
  const attemptedSourceKeysRef = useRef<ReadonlySet<string>>(new Set())
  const activeSessionsRef = useRef<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (!settings?.enabled || !settings.auto_extract) return

    const counts = new Map<string, number>()
    for (const session of sessions) {
      counts.set(
        session.id,
        session.messages.filter(isMemoryExtractionMessage).length
      )
    }
    if (!initialisedRef.current) {
      initialisedRef.current = true
      completedCountsRef.current = counts
      return
    }

    for (const session of sessions) {
      if (activeSessionsRef.current.has(session.id)) continue
      const completedCount = counts.get(session.id) ?? 0
      const previousCount = completedCountsRef.current.get(session.id)
      if (previousCount === undefined) {
        completedCountsRef.current.set(session.id, completedCount)
        continue
      }
      if (completedCount <= previousCount) {
        completedCountsRef.current.set(session.id, completedCount)
        continue
      }
      if (completedCount - previousCount < settings.extract_every_rounds) {
        continue
      }

      const completedMessages = session.messages.filter(
        isMemoryExtractionMessage
      )
      const lastMessage = completedMessages.at(-1)
      if (!lastMessage) continue
      const sourceKey = `${session.id}:${lastMessage.key}`
      if (attemptedSourceKeysRef.current.has(sourceKey)) continue

      attemptedSourceKeysRef.current = new Set([
        ...attemptedSourceKeysRef.current,
        sourceKey,
      ])
      completedCountsRef.current.set(session.id, completedCount)
      activeSessionsRef.current = new Set([
        ...activeSessionsRef.current,
        session.id,
      ])

      const windowMessages = session.messages
        .filter(
          (message) =>
            !message.isContextSummary &&
            message.versions[0]?.content.trim().length > 0
        )
        .slice(-settings.extract_window_messages)
      void sendChatCompletion({
        model: config.model,
        group: config.group,
        messages: buildMemoryExtractionMessages(windowMessages),
        stream: false,
        max_tokens: 2_000,
      })
        .then(async (response) => {
          const message = response.choices?.[0]?.message
          const content = getMemoryExtractionResponseContent(
            message?.content,
            message?.reasoning_content ?? message?.reasoning
          )
          const memories = parseExtractedMemories(content).map((memory) => ({
            ...memory,
            conversation_id: session.id,
            source_key: sourceKey,
          }))
          if (memories.length > 0) {
            await saveUserMemories(memories)
          }
        })
        .catch(() => {
          // Memory extraction is best-effort and must never interrupt chat.
        })
        .finally(() => {
          const next = new Set(activeSessionsRef.current)
          next.delete(session.id)
          activeSessionsRef.current = next
        })
    }
  }, [config.group, config.model, sessions, settings])
}
