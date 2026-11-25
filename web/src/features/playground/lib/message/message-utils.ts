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

import { MESSAGE_ROLES, MESSAGE_STATUS } from '../../constants'
import type {
  Message,
  MessageAttachment,
  MessageVersion,
  ChatCompletionMessage,
  ContentPart,
} from '../../types'

/**
 * Create a new message version
 */
export function createMessageVersion(
  content: string,
  attachments: MessageAttachment[] = []
): MessageVersion {
  return {
    id: nanoid(),
    content,
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

export function getCurrentVersion(message: Message): MessageVersion {
  return (
    message.versions.find(
      (version) => version.id === message.activeVersionId
    ) ||
    message.versions[0] || { id: 'default', content: '' }
  )
}

/**
 * Get displayable content from the current message version.
 */
export function getMessageContent(message: Message): string {
  return getCurrentVersion(message).content
}

/**
 * Check whether a message has non-empty content in its current version.
 */
export function hasMessageContent(message: Message): boolean {
  return (
    getMessageContent(message).trim() !== '' ||
    (getCurrentVersion(message).attachments?.length ?? 0) > 0
  )
}

/**
 * Update current version content in message
 */
export function updateCurrentVersionContent(
  message: Message,
  content: string
): Message {
  const currentVersion = getCurrentVersion(message)
  return {
    ...message,
    versions: message.versions.map((version) =>
      version.id === currentVersion.id ? { ...version, content } : version
    ),
  }
}

export function captureCurrentMessageVersion(message: Message): Message {
  const currentVersion = getCurrentVersion(message)
  return {
    ...message,
    versions: message.versions.map((version) =>
      version.id === currentVersion.id
        ? {
            ...version,
            model: message.model,
            createdAt: message.createdAt,
            startedAt: message.startedAt,
            completedAt: message.completedAt,
            durationMs: message.durationMs,
            sources: message.sources,
            webSearch: message.webSearch,
            reasoning: message.reasoning,
            status: message.status,
            errorCode: message.errorCode,
            usage: message.usage,
          }
        : version
    ),
  }
}

export function switchMessageVersion(
  message: Message,
  versionId: string
): Message {
  const captured = captureCurrentMessageVersion(message)
  const version = captured.versions.find((item) => item.id === versionId)
  if (!version || version.id === getCurrentVersion(captured).id) {
    return message
  }

  return {
    ...captured,
    activeVersionId: version.id,
    model: version.model,
    createdAt: version.createdAt ?? captured.createdAt,
    startedAt: version.startedAt,
    completedAt: version.completedAt,
    durationMs: version.durationMs,
    sources: version.sources,
    webSearch: version.webSearch,
    reasoning: version.reasoning,
    status: version.status ?? MESSAGE_STATUS.COMPLETE,
    errorCode: version.errorCode ?? null,
    usage: version.usage,
    isReasoningStreaming: false,
    isReasoningComplete: true,
    isContentComplete: true,
  }
}

/**
 * Create a user message
 */
export function createUserMessage(
  content: string,
  createdAt: number = Date.now(),
  attachments: MessageAttachment[] = []
): Message {
  const version = createMessageVersion(content, attachments)
  return {
    key: nanoid(),
    from: MESSAGE_ROLES.USER,
    versions: [version],
    activeVersionId: version.id,
    createdAt,
  }
}

/**
 * Create a loading assistant message
 */
export function createLoadingAssistantMessage(
  startedAt: number = Date.now()
): Message {
  const version = createMessageVersion('')
  return {
    key: nanoid(),
    from: MESSAGE_ROLES.ASSISTANT,
    versions: [version],
    activeVersionId: version.id,
    createdAt: startedAt,
    startedAt,
    reasoning: undefined,
    isReasoningComplete: false,
    isContentComplete: false,
    isReasoningStreaming: false,
    status: MESSAGE_STATUS.LOADING,
  }
}

/**
 * Build message content with optional images and files.
 */
export function buildMessageContent(
  text: string,
  attachments: MessageAttachment[] = []
): string | ContentPart[] {
  if (attachments.length === 0) {
    return text
  }

  const parts: ContentPart[] = []
  if (text.trim()) {
    parts.push({
      type: 'text',
      text,
    })
  }

  for (const attachment of attachments) {
    if (
      attachment.kind === 'image' &&
      attachment.mediaType.startsWith('image/')
    ) {
      parts.push({
        type: 'image_url',
        image_url: { url: attachment.dataUrl },
      })
      continue
    }

    parts.push({
      type: 'file',
      file: {
        filename: attachment.name,
        file_data: attachment.dataUrl,
      },
    })
  }

  return parts
}

/**
 * Extract text content from message content
 */
export function getTextContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const textPart = content.find((part) => part.type === 'text')
    return textPart?.text || ''
  }

  return ''
}

/**
 * Format message for API request
 */
export function formatMessageForAPI(message: Message): ChatCompletionMessage {
  const currentVersion = getCurrentVersion(message)
  return {
    role: message.from,
    content: buildMessageContent(
      currentVersion.content,
      currentVersion.attachments ?? []
    ),
  }
}

/**
 * Check if message is valid for API request
 * Excludes loading/streaming assistant messages and empty content
 */
export function isValidMessage(message: Message): boolean {
  if (!message || !message.from || !message.versions.length) return false

  // Exclude empty assistant messages (loading/streaming placeholders)
  if (message.from === MESSAGE_ROLES.ASSISTANT && !hasMessageContent(message)) {
    return false
  }

  return true
}
