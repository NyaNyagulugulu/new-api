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

import { MESSAGE_ROLES } from '../../constants'
import type { ChatSession, Message } from '../../types'

const CHAT_TITLE_MAX_LENGTH = 48
const DAY_MS = 24 * 60 * 60 * 1000

export type ChatSessionDateGroup = 'today' | 'yesterday' | 'last7Days' | 'older'

export type ChatSessionGroup = {
  key: ChatSessionDateGroup
  sessions: ChatSession[]
}

function getMessageText(message: Message): string {
  return message.versions[0]?.content ?? ''
}

export function getChatSessionLatestMessageTime(session: ChatSession): number {
  let latestMessageAt = 0
  for (const message of session.messages) {
    for (const timestamp of [
      message.completedAt,
      message.startedAt,
      message.createdAt,
    ]) {
      if (typeof timestamp === 'number' && timestamp > latestMessageAt) {
        latestMessageAt = timestamp
      }
    }
  }
  return latestMessageAt
}

export function getChatSessionRecencyTime(session: ChatSession): number {
  // Streaming also bumps session.updatedAt. Prefer stable message timestamps so
  // sidebar order changes only on real conversation activity.
  return getChatSessionLatestMessageTime(session) || session.updatedAt
}

export function normalizeChatSessionRecency(session: ChatSession): ChatSession {
  const latestMessageAt = getChatSessionLatestMessageTime(session)
  if (latestMessageAt === 0 || latestMessageAt === session.updatedAt) {
    return session
  }
  return { ...session, updatedAt: latestMessageAt }
}

function toChatTitle(text: string): string {
  const normalized = text.replaceAll(/\s+/g, ' ').trim()
  if (normalized.length <= CHAT_TITLE_MAX_LENGTH) {
    return normalized
  }

  return `${normalized.slice(0, CHAT_TITLE_MAX_LENGTH - 1).trimEnd()}…`
}

export function getChatSessionTitle(
  session: ChatSession,
  fallbackTitle: string
): string {
  if (session.title.trim()) {
    return session.title
  }

  const firstUserMessage = session.messages.find(
    (message) => message.from === MESSAGE_ROLES.USER
  )
  return firstUserMessage
    ? toChatTitle(getMessageText(firstUserMessage)) || fallbackTitle
    : fallbackTitle
}

export function createChatSessionId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  return nanoid()
}

export function createChatSession(
  messages: Message[] = [],
  timestamp = Date.now(),
  id = createChatSessionId(),
  personaId = 0
): ChatSession {
  return {
    id,
    title: '',
    personaId,
    messages,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function getStartOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function getSessionDateGroup(
  session: ChatSession,
  now: number
): ChatSessionDateGroup {
  const recency = getChatSessionRecencyTime(session)
  const startOfToday = getStartOfDay(now)
  if (recency >= startOfToday) {
    return 'today'
  }

  if (recency >= startOfToday - DAY_MS) {
    return 'yesterday'
  }

  if (recency >= startOfToday - 7 * DAY_MS) {
    return 'last7Days'
  }

  return 'older'
}

function compareChatSessionsByRecency(left: ChatSession, right: ChatSession) {
  return (
    getChatSessionRecencyTime(right) - getChatSessionRecencyTime(left) ||
    left.id.localeCompare(right.id)
  )
}

export function groupChatSessionsByDate(
  sessions: ChatSession[],
  now = Date.now()
): ChatSessionGroup[] {
  const grouped = new Map<ChatSessionDateGroup, ChatSession[]>([
    ['today', []],
    ['yesterday', []],
    ['last7Days', []],
    ['older', []],
  ])

  const newestFirst = [...sessions].sort(compareChatSessionsByRecency)
  for (const session of newestFirst) {
    grouped.get(getSessionDateGroup(session, now))?.push(session)
  }

  return (['today', 'yesterday', 'last7Days', 'older'] as const)
    .map((key) => ({ key, sessions: grouped.get(key) ?? [] }))
    .filter((group) => group.sessions.length > 0)
}

/**
 * Merge local fallback data with server history.
 *
 * Server history is authoritative for conversations it knows about. A local
 * conversation missing from a non-empty server snapshot is retained only when
 * it is newer than every server conversation, which preserves work created
 * while offline without resurrecting old deleted chats.
 */
export function mergeChatSessions(
  localSessions: ChatSession[],
  serverSessions: ChatSession[]
): ChatSession[] {
  localSessions = localSessions.map(normalizeChatSessionRecency)
  serverSessions = serverSessions.map(normalizeChatSessionRecency)
  if (serverSessions.length === 0) return localSessions

  const serverLatest = Math.max(
    ...serverSessions.map((session) => session.updatedAt)
  )
  const merged = new Map(serverSessions.map((session) => [session.id, session]))

  for (const localSession of localSessions) {
    const serverSession = merged.get(localSession.id)
    if (serverSession) {
      if (localSession.updatedAt > serverSession.updatedAt) {
        merged.set(localSession.id, localSession)
      }
      continue
    }

    if (localSession.updatedAt > serverLatest) {
      merged.set(localSession.id, localSession)
    }
  }

  return [...merged.values()].sort(compareChatSessionsByRecency)
}
