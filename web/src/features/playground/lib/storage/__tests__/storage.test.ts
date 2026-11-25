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
import { afterEach, beforeEach, expect, test } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { STORAGE_KEYS } from '../../../constants'
import type { ChatSession, Message } from '../../../types'
import {
  clearPlaygroundData,
  loadActiveChatSessionId,
  loadChatSessions,
  loadConfig,
  loadMessages,
  loadParameterEnabled,
  saveActiveChatSessionId,
  saveChatSessions,
  saveConfig,
  saveMessages,
  saveParameterEnabled,
} from '../storage'

const messages: Message[] = [
  {
    key: 'a-chat',
    from: 'user',
    versions: [{ id: 'a-version', content: 'Account A private chat' }],
  },
]

const sessions: ChatSession[] = [
  {
    id: 'session-a',
    title: 'Account A chat',
    personaId: 0,
    messages,
    createdAt: 100,
    updatedAt: 200,
  },
]

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})

afterEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})

test('switching accounts isolates config, chats and parameter toggles and preserves returning account data', () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'A', role: 1 })
  saveConfig({ model: 'account-a-model' })
  saveChatSessions(sessions)
  saveActiveChatSessionId('session-a')
  saveParameterEnabled({ temperature: true })

  useAuthStore.getState().auth.reset()
  useAuthStore.getState().auth.setUser({ id: 2, username: 'B', role: 1 })
  expect(loadConfig()).toEqual({})
  expect(loadChatSessions()).toEqual([])
  expect(loadMessages()).toBeNull()
  expect(loadParameterEnabled()).toEqual({})
  saveConfig({ model: 'account-b-model' })
  saveChatSessions([])
  saveActiveChatSessionId(null)
  saveParameterEnabled({ temperature: false })

  useAuthStore.getState().auth.setUser({ id: 1, username: 'A', role: 1 })
  expect(loadConfig()).toEqual({ model: 'account-a-model' })
  expect(loadChatSessions()).toEqual(sessions)
  expect(loadActiveChatSessionId()).toBe('session-a')
  expect(loadParameterEnabled()).toEqual({ temperature: true })

  clearPlaygroundData()
  expect(loadChatSessions()).toEqual([])
  expect(loadActiveChatSessionId()).toBeNull()
  useAuthStore.getState().auth.setUser({ id: 2, username: 'B', role: 1 })
  expect(loadConfig()).toEqual({ model: 'account-b-model' })
  expect(loadChatSessions()).toEqual([])
  expect(loadParameterEnabled()).toEqual({ temperature: false })
})

test('legacy transcript is migrated into the first web chat session', () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'A', role: 1 })
  saveMessages(messages)

  expect(loadChatSessions()).toMatchObject([
    {
      title: '',
      messages,
    },
  ])
})

test('legacy global data is removed instead of assigned to the first signed-in account', () => {
  localStorage.setItem(
    STORAGE_KEYS.CONFIG,
    JSON.stringify({ model: 'legacy-model' })
  )
  localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages))
  localStorage.setItem(
    STORAGE_KEYS.PARAMETER_ENABLED,
    JSON.stringify({ temperature: true })
  )
  useAuthStore.getState().auth.setUser({ id: 2, username: 'B', role: 1 })

  expect(loadConfig()).toEqual({})
  expect(loadMessages()).toBeNull()
  expect(loadParameterEnabled()).toEqual({})
  for (const key of Object.values(STORAGE_KEYS)) {
    expect(localStorage.getItem(key)).toBeNull()
  }
})

test('storage calls without a signed-in user do not persist shared data', () => {
  saveConfig({ model: 'signed-out-model' })
  saveMessages(messages)
  saveParameterEnabled({ temperature: true })
  expect(loadConfig()).toEqual({})
  expect(loadMessages()).toBeNull()
  expect(loadParameterEnabled()).toEqual({})
  expect(localStorage.length).toBe(0)
})
