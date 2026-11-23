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
import { nanoid } from 'nanoid'
import { useCallback, useEffect, useRef, useState } from 'react'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../constants'
import {
  applyMessageStateUpdate,
  createChatSession,
  getInitialParameterEnabled,
  getInitialPlaygroundConfig,
  loadActiveChatSessionId,
  loadChatSessions,
  saveActiveChatSessionId,
  saveChatSessions,
  saveConfig,
  saveParameterEnabled,
  type MessageStateUpdater,
} from '../lib'
import type {
  ChatSession,
  Message,
  PlaygroundConfig,
  ParameterEnabled,
  ModelOption,
  GroupOption,
} from '../types'

const SESSION_SAVE_DEBOUNCE_MS = 500
const EMPTY_MESSAGES: Message[] = []

/**
 * Main state management hook for the web chat.
 */
export function usePlaygroundState() {
  const [config, setConfig] = useState<PlaygroundConfig>(
    getInitialPlaygroundConfig
  )
  const [parameterEnabled, setParameterEnabled] = useState<ParameterEnabled>(
    getInitialParameterEnabled
  )
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  )
  const [isLoadingMessages, setIsLoadingMessages] = useState(true)
  const [models, setModels] = useState<ModelOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])

  const activeSessionIdRef = useRef<string | null>(null)
  const sessionsRef = useRef<ChatSession[]>([])
  const hasLoadedSessionsRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)

  const setActiveSessionId = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = sessionId
    setActiveSessionIdState(sessionId)
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadTimer = window.setTimeout(() => {
      const loadedSessions = loadChatSessions()
      if (cancelled) return

      const storedActiveSessionId = loadActiveChatSessionId()
      const nextActiveSessionId = loadedSessions.some(
        (session) => session.id === storedActiveSessionId
      )
        ? storedActiveSessionId
        : null

      sessionsRef.current = loadedSessions
      hasLoadedSessionsRef.current = true
      setSessions(loadedSessions)
      setActiveSessionId(nextActiveSessionId)
      setIsLoadingMessages(false)
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(loadTimer)
    }
  }, [setActiveSessionId])

  useEffect(() => {
    sessionsRef.current = sessions
    if (!hasLoadedSessionsRef.current) return

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      saveChatSessions(sessionsRef.current)
      saveActiveChatSessionId(activeSessionIdRef.current)
    }, SESSION_SAVE_DEBOUNCE_MS)
  }, [activeSessionId, sessions])

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveChatSessions(sessionsRef.current)
        saveActiveChatSessionId(activeSessionIdRef.current)
      }
    },
    []
  )

  const updateConfig = useCallback(
    <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) => {
      setConfig((previousConfig) => {
        const updated = { ...previousConfig, [key]: value }
        saveConfig(updated)
        return updated
      })
    },
    []
  )

  const updateParameterEnabled = useCallback(
    (key: keyof ParameterEnabled, value: boolean) => {
      setParameterEnabled((previousParameterEnabled) => {
        const updated = { ...previousParameterEnabled, [key]: value }
        saveParameterEnabled(updated)
        return updated
      })
    },
    []
  )

  const updateMessages = useCallback(
    (updater: MessageStateUpdater) => {
      const currentSessionId = activeSessionIdRef.current
      const targetSessionId = currentSessionId ?? nanoid()
      const initialMessages = currentSessionId
        ? null
        : applyMessageStateUpdate([], updater)

      if (initialMessages?.length === 0) return
      if (!currentSessionId) {
        setActiveSessionId(targetSessionId)
      }

      setSessions((previousSessions) => {
        const sessionIndex = previousSessions.findIndex(
          (session) => session.id === targetSessionId
        )

        if (sessionIndex === -1) {
          if (!initialMessages || initialMessages.length === 0) {
            return previousSessions
          }

          return [
            createChatSession(initialMessages, Date.now(), targetSessionId),
            ...previousSessions,
          ]
        }

        const currentSession = previousSessions[sessionIndex]
        const nextMessages = applyMessageStateUpdate(
          currentSession.messages,
          updater
        )
        if (nextMessages === currentSession.messages) {
          return previousSessions
        }

        const otherSessions = previousSessions.filter(
          (session) => session.id !== targetSessionId
        )
        if (nextMessages.length === 0) {
          return [
            {
              ...currentSession,
              messages: [],
              updatedAt: Date.now(),
            },
            ...otherSessions,
          ]
        }

        return [
          {
            ...currentSession,
            messages: nextMessages,
            updatedAt: Date.now(),
          },
          ...otherSessions,
        ]
      })
    },
    [setActiveSessionId]
  )

  const createNewChat = useCallback(() => {
    setActiveSessionId(null)
  }, [setActiveSessionId])

  const selectChat = useCallback(
    (sessionId: string) => {
      if (!sessionsRef.current.some((session) => session.id === sessionId)) {
        return
      }

      setActiveSessionId(sessionId)
    },
    [setActiveSessionId]
  )

  const renameChat = useCallback((sessionId: string, title: string) => {
    const nextTitle = title.trim()
    if (!nextTitle) return

    setSessions((previousSessions) =>
      previousSessions.map((session) =>
        session.id === sessionId ? { ...session, title: nextTitle } : session
      )
    )
  }, [])

  const deleteChat = useCallback(
    (sessionId: string) => {
      setSessions((previousSessions) =>
        previousSessions.filter((session) => session.id !== sessionId)
      )
      if (activeSessionIdRef.current === sessionId) {
        createNewChat()
      }
    },
    [createNewChat]
  )

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG)
    setParameterEnabled(DEFAULT_PARAMETER_ENABLED)
    saveConfig(DEFAULT_CONFIG)
    saveParameterEnabled(DEFAULT_PARAMETER_ENABLED)
  }, [])

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? null

  return {
    config,
    parameterEnabled,
    messages: activeSession?.messages ?? EMPTY_MESSAGES,
    activeSession,
    sessions,
    isLoadingMessages,
    models,
    groups,
    setModels,
    setGroups,
    updateConfig,
    updateParameterEnabled,
    updateMessages,
    createNewChat,
    selectChat,
    renameChat,
    deleteChat,
    resetConfig,
  }
}
