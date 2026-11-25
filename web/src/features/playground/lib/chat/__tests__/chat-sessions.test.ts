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
import { expect, test } from 'vitest'

import type { ChatSession, Message } from '../../../types'
import {
  createChatSession,
  getChatSessionTitle,
  groupChatSessionsByDate,
  mergeChatSessions,
  normalizeChatSessionRecency,
} from '../chat-sessions'

const userMessage: Message = {
  key: 'message-1',
  from: 'user',
  versions: [
    {
      id: 'version-1',
      content: '  Explain   database indexes in a concise way  ',
    },
  ],
}

function createSession(id: string, updatedAt: number, title = ''): ChatSession {
  return {
    ...createChatSession([], updatedAt, id),
    title,
    messages: [userMessage],
  }
}

test('a new chat uses its first user message as the generated title', () => {
  const session = createChatSession([userMessage], 100, 'chat-1')

  expect(getChatSessionTitle(session, 'New chat')).toBe(
    'Explain database indexes in a concise way'
  )
})

test('a renamed chat keeps its custom title', () => {
  const session = { ...createSession('chat-1', 100), title: 'Database notes' }

  expect(getChatSessionTitle(session, 'New chat')).toBe('Database notes')
})

test('sessions are grouped by recency with the newest group first', () => {
  const now = new Date(2026, 10, 23, 12).getTime()
  const today = new Date(2026, 10, 23, 9).getTime()
  const yesterday = new Date(2026, 10, 22, 9).getTime()
  const lastWeek = new Date(2026, 10, 19, 9).getTime()
  const older = new Date(2026, 9, 1, 9).getTime()

  const groups = groupChatSessionsByDate(
    [
      createSession('older', older),
      createSession('today', today),
      createSession('last-week', lastWeek),
      createSession('yesterday', yesterday),
    ],
    now
  )

  expect(groups.map((group) => group.key)).toEqual([
    'today',
    'yesterday',
    'last7Days',
    'older',
  ])
  expect(groups.map((group) => group.sessions[0].id)).toEqual([
    'today',
    'yesterday',
    'last-week',
    'older',
  ])
})

test('sessions inside each date group are ordered by their latest message', () => {
  const now = new Date(2026, 10, 23, 12).getTime()
  const groups = groupChatSessionsByDate(
    [
      createSession('oldest', now - 3 * 60 * 60 * 1000),
      createSession('newest', now - 60 * 60 * 1000),
      createSession('middle', now - 2 * 60 * 60 * 1000),
    ],
    now
  )

  expect(groups[0].sessions.map((session) => session.id)).toEqual([
    'newest',
    'middle',
    'oldest',
  ])
})

test('streaming timestamp churn does not reorder conversations', () => {
  const now = new Date(2026, 10, 23, 12).getTime()
  const older = createSession('older', now)
  const newer = createSession('newer', now)
  older.messages = [
    { ...userMessage, key: 'older-message', createdAt: now - 2_000 },
  ]
  newer.messages = [
    { ...userMessage, key: 'newer-message', createdAt: now - 1_000 },
  ]

  const groups = groupChatSessionsByDate(
    [
      { ...older, updatedAt: now + 20_000 },
      { ...newer, updatedAt: now + 10_000 },
    ],
    now
  )

  expect(groups[0].sessions.map((session) => session.id)).toEqual([
    'newer',
    'older',
  ])
})

test('sessions with the same latest-message time keep a deterministic order', () => {
  const now = new Date(2026, 10, 23, 12).getTime()

  const first = groupChatSessionsByDate(
    [createSession('beta', now), createSession('alpha', now)],
    now
  )
  const second = groupChatSessionsByDate(
    [createSession('alpha', now), createSession('beta', now)],
    now
  )

  expect(first[0].sessions.map((session) => session.id)).toEqual([
    'alpha',
    'beta',
  ])
  expect(second[0].sessions.map((session) => session.id)).toEqual([
    'alpha',
    'beta',
  ])
})

test('uses the latest message timestamp instead of a polluted session timestamp', () => {
  const session = createSession('chat-1', 500, 'Polluted recency')
  const normalized = normalizeChatSessionRecency({
    ...session,
    messages: [
      {
        ...userMessage,
        createdAt: 100,
        startedAt: 110,
        completedAt: 120,
      },
    ],
  })

  expect(normalized.updatedAt).toBe(120)
})

test('server history wins while newer offline work is preserved', () => {
  const localNewer = createSession('local-newer', 300, 'Local newer')
  const localDeleted = createSession('local-deleted', 50, 'Old local copy')
  const server = createSession('server', 100, 'Server copy')
  const remoteUpdate = { ...server, updatedAt: 200, title: 'Server newer' }

  const merged = mergeChatSessions(
    [
      localNewer,
      localDeleted,
      { ...server, updatedAt: 150, title: 'Local old' },
    ],
    [remoteUpdate]
  )

  expect(merged.map((session) => session.id)).toEqual(['local-newer', 'server'])
  expect(merged.find((session) => session.id === 'server')?.title).toBe(
    'Server newer'
  )
})
