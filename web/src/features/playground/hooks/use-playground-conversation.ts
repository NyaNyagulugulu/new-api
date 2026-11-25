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
import { useCallback, useState } from 'react'

import {
  appendUserMessagePair,
  applyMessageEdit,
  createRegeneratedMessages,
  removeMessageByKey,
  switchMessageVersion,
} from '../lib'
import type { Message, MessageAttachment } from '../types'

type UsePlaygroundConversationOptions = {
  messages: Message[]
  updateMessages: (
    updater: Message[] | ((prev: Message[]) => Message[]),
    sessionId?: string
  ) => void
  ensureActiveSessionId: () => string
  sendChat: (messages: Message[], sessionId?: string) => void
}

export function usePlaygroundConversation({
  messages,
  updateMessages,
  ensureActiveSessionId,
  sendChat,
}: UsePlaygroundConversationOptions) {
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(
    null
  )

  const handleSendMessage = useCallback(
    (text: string, attachments: MessageAttachment[] = []) => {
      const sessionId = ensureActiveSessionId()
      const nextMessages = appendUserMessagePair(messages, text, attachments)
      updateMessages(nextMessages, sessionId)
      sendChat(nextMessages, sessionId)
    },
    [ensureActiveSessionId, messages, updateMessages, sendChat]
  )

  const handleRegenerateMessage = useCallback(
    (message: Message) => {
      const nextMessages = createRegeneratedMessages(messages, message.key)
      if (!nextMessages) return

      const sessionId = ensureActiveSessionId()
      updateMessages(nextMessages, sessionId)
      sendChat(nextMessages, sessionId)
    },
    [ensureActiveSessionId, messages, updateMessages, sendChat]
  )

  const handleEditMessage = useCallback((message: Message) => {
    setEditingMessageKey(message.key)
  }, [])

  const handleEditOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingMessageKey(null)
    }
  }, [])

  const applyEdit = useCallback(
    (newContent: string, shouldSubmit: boolean) => {
      if (!editingMessageKey) return

      const editResult = applyMessageEdit(
        messages,
        editingMessageKey,
        newContent,
        shouldSubmit
      )
      if (!editResult) return

      setEditingMessageKey(null)
      updateMessages(editResult.messages)

      if (editResult.shouldSend) {
        const sessionId = ensureActiveSessionId()
        sendChat(editResult.messages, sessionId)
      }
    },
    [
      editingMessageKey,
      ensureActiveSessionId,
      messages,
      updateMessages,
      sendChat,
    ]
  )

  const handleDeleteMessage = useCallback(
    (message: Message) => {
      updateMessages((previousMessages) =>
        removeMessageByKey(previousMessages, message.key)
      )
    },
    [updateMessages]
  )

  const handleSwitchMessageVersion = useCallback(
    (message: Message, versionId: string) => {
      updateMessages((previousMessages) =>
        previousMessages.map((item) =>
          item.key === message.key
            ? switchMessageVersion(item, versionId)
            : item
        )
      )
    },
    [updateMessages]
  )

  return {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
    handleSwitchMessageVersion,
  }
}
