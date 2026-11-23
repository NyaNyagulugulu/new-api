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
  ChatCompletionMessage,
  Message,
  MessageAttachment,
} from '../../types'
import { isAssistantMessagePending } from '../message/message-streaming-utils'
import { formatMessageForAPI } from '../message/message-utils'

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000
export const CONTEXT_COMPACTION_TRIGGER_RATIO = 0.7
export const CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS = 2_000

const CONTEXT_COMPACTION_KEEP_RATIO = 0.25
const CONTEXT_COMPACTION_MIN_KEEP_TOKENS = 4_000
const CONTEXT_COMPACTION_MAX_KEEP_TOKENS = 24_000
const MESSAGE_OVERHEAD_TOKENS = 8
const IMAGE_ATTACHMENT_TOKENS = 1_000
const FILE_ATTACHMENT_TOKENS = 2_000

type ContextCompactionPlan = {
  firstKeptMessageKey: string
  sourceMessages: Message[]
}

function estimateTextTokens(text: string): number {
  let tokens = 0
  for (const character of text) {
    tokens += (character.codePointAt(0) ?? 0) <= 0x7f ? 0.25 : 1
  }
  return Math.ceil(tokens)
}

function estimateAttachmentTokens(attachments: MessageAttachment[]): number {
  let tokens = 0
  for (const attachment of attachments) {
    tokens +=
      attachment.kind === 'image'
        ? IMAGE_ATTACHMENT_TOKENS
        : FILE_ATTACHMENT_TOKENS
  }
  return tokens
}

export function estimateMessageTokens(message: Message): number {
  const version = message.versions[0]
  return (
    estimateTextTokens(version?.content ?? '') +
    estimateAttachmentTokens(version?.attachments ?? []) +
    MESSAGE_OVERHEAD_TOKENS
  )
}

export function getEffectiveContextMessages(messages: Message[]): Message[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].isContextSummary) {
      return messages.slice(index)
    }
  }
  return messages
}

export function estimateContextTokens(messages: Message[]): number {
  return getEffectiveContextMessages(messages).reduce(
    (total, message) => total + estimateMessageTokens(message),
    0
  )
}

export function shouldCompactContext(
  messages: Message[],
  contextWindowTokens: number,
  reservedOutputTokens = 0,
  extraTokens = 0
): boolean {
  const contextWindow =
    contextWindowTokens > 0
      ? contextWindowTokens
      : DEFAULT_CONTEXT_WINDOW_TOKENS
  const threshold = Math.max(
    4_000,
    contextWindow * CONTEXT_COMPACTION_TRIGGER_RATIO - reservedOutputTokens
  )
  return estimateContextTokens(messages) + extraTokens >= threshold
}

function isValidSummarySource(message: Message): boolean {
  return (
    !message.isContextSummary || message.versions[0]?.content.trim().length > 0
  )
}

export function planContextCompaction(
  messages: Message[],
  contextWindowTokens: number
): ContextCompactionPlan | null {
  const effectiveMessages = getEffectiveContextMessages(messages).filter(
    (message) => !isAssistantMessagePending(message)
  )
  if (effectiveMessages.length <= 1) return null

  const contextWindow =
    contextWindowTokens > 0
      ? contextWindowTokens
      : DEFAULT_CONTEXT_WINDOW_TOKENS
  const keepBudget = Math.min(
    CONTEXT_COMPACTION_MAX_KEEP_TOKENS,
    Math.max(
      CONTEXT_COMPACTION_MIN_KEEP_TOKENS,
      Math.floor(contextWindow * CONTEXT_COMPACTION_KEEP_RATIO)
    )
  )

  let keepStart = effectiveMessages.length
  let keptTokens = 0
  for (let index = effectiveMessages.length - 1; index >= 0; index--) {
    const messageTokens = estimateMessageTokens(effectiveMessages[index])
    if (
      keepStart < effectiveMessages.length &&
      keptTokens + messageTokens > keepBudget
    ) {
      break
    }
    keepStart = index
    keptTokens += messageTokens
  }

  let lastUserIndex = -1
  for (let index = effectiveMessages.length - 1; index >= 0; index--) {
    if (effectiveMessages[index].from === MESSAGE_ROLES.USER) {
      lastUserIndex = index
      break
    }
  }
  if (lastUserIndex >= 0) {
    keepStart = Math.min(keepStart, lastUserIndex)
  }

  while (
    keepStart > 0 &&
    effectiveMessages[keepStart].from === MESSAGE_ROLES.ASSISTANT
  ) {
    keepStart--
  }

  const sourceMessages = effectiveMessages
    .slice(0, keepStart)
    .filter(isValidSummarySource)
  const firstKeptMessage = effectiveMessages[keepStart]
  if (sourceMessages.length === 0 || !firstKeptMessage) return null

  return {
    firstKeptMessageKey: firstKeptMessage.key,
    sourceMessages,
  }
}

export function buildContextSummaryRequestMessages(
  sourceMessages: Message[]
): ChatCompletionMessage[] {
  return [
    {
      role: MESSAGE_ROLES.SYSTEM,
      content: [
        'Compact the earlier conversation below into a concise context summary.',
        'Preserve concrete facts, decisions, constraints, code and file names, user preferences, and unresolved tasks.',
        'Remove repetition and conversational filler.',
        'Use the same language as the conversation.',
        'Return only the summary, with no preamble or commentary.',
      ].join(' '),
    },
    ...sourceMessages.map(formatMessageForAPI),
  ]
}

export function createContextSummaryMessage(
  content: string,
  timestamp = Date.now()
): Message {
  return {
    key: `context-summary-${nanoid()}`,
    from: MESSAGE_ROLES.SYSTEM,
    versions: [{ id: nanoid(), content: content.trim() }],
    createdAt: timestamp,
    completedAt: timestamp,
    status: MESSAGE_STATUS.COMPLETE,
    isContextSummary: true,
  }
}

export function insertContextSummaryMessage(
  messages: Message[],
  summaryMessage: Message,
  firstKeptMessageKey: string
): Message[] {
  const withoutPreviousSummary = messages.filter(
    (message) => !message.isContextSummary
  )
  const firstKeptIndex = withoutPreviousSummary.findIndex(
    (message) => message.key === firstKeptMessageKey
  )
  const insertIndex =
    firstKeptIndex === -1 ? withoutPreviousSummary.length : firstKeptIndex

  return [
    ...withoutPreviousSummary.slice(0, insertIndex),
    summaryMessage,
    ...withoutPreviousSummary.slice(insertIndex),
  ]
}
