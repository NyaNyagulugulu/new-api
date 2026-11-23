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
import { MESSAGE_ROLES, MESSAGE_STATUS } from '../../constants'
import type { ChatSession, Message } from '../../types'

const TITLE_MAX_LENGTH = 64
const TITLE_CONTEXT_MAX_LENGTH = 2_000

function messageText(message: Message): string {
  return (message.versions[0]?.content ?? '').replaceAll(/\s+/g, ' ').trim()
}

function completedAssistantMessage(session: ChatSession): Message | undefined {
  return session.messages.find(
    (message) =>
      message.from === MESSAGE_ROLES.ASSISTANT &&
      message.status === MESSAGE_STATUS.COMPLETE &&
      messageText(message).length > 0
  )
}

export function canGenerateChatTitle(session: ChatSession): boolean {
  if (session.title.trim()) return false
  const firstUserMessage = session.messages.find(
    (message) => message.from === MESSAGE_ROLES.USER
  )
  return Boolean(firstUserMessage && completedAssistantMessage(session))
}

export function buildChatTitlePrompt(session: ChatSession): string {
  const userText =
    session.messages
      .find((message) => message.from === MESSAGE_ROLES.USER)
      ?.versions[0]?.content.slice(0, TITLE_CONTEXT_MAX_LENGTH) ?? ''
  const assistantText =
    completedAssistantMessage(session)?.versions[0]?.content.slice(
      0,
      TITLE_CONTEXT_MAX_LENGTH
    ) ?? ''

  return [
    'Create a short, specific title for this conversation.',
    'Use the same language as the conversation.',
    'Return only the title, without quotes, markdown, prefixes, or punctuation at the end.',
    'Keep it under 8 words and 64 characters.',
    '',
    `User: ${userText}`,
    `Assistant: ${assistantText}`,
  ].join('\n')
}

export function extractChatTitle(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
  const normalized = firstLine
    .replaceAll(/^["'“”‘’`*#\s]+|["'“”‘’`*\s]+$/g, '')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/[.:;!?。！？：；，,]+$/g, '')
    .trim()

  return normalized.slice(0, TITLE_MAX_LENGTH).trim()
}
