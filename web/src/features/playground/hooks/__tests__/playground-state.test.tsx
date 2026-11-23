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
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import {
  appendUserMessagePair,
  applyStreamingChunk,
  updateLastAssistantMessage,
} from '../../lib'
import { usePlaygroundState } from '../use-playground-state'

const apiMocks = vi.hoisted(() => ({
  getChatConversations: vi.fn(),
  syncChatConversations: vi.fn(),
}))

vi.mock('../../api', () => ({
  getChatConversations: apiMocks.getChatConversations,
  syncChatConversations: apiMocks.syncChatConversations,
}))

beforeEach(() => {
  localStorage.clear()
  apiMocks.getChatConversations.mockResolvedValue([])
  apiMocks.syncChatConversations.mockResolvedValue([])
  useAuthStore.getState().auth.reset()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'A', role: 1 })
})

test('stream updates target an existing background session', async () => {
  const { result } = renderHook(() => usePlaygroundState())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))

  let sessionId = ''
  act(() => {
    sessionId = result.current.ensureActiveSessionId()
    result.current.updateMessages(appendUserMessagePair([], 'Hello'), sessionId)
  })

  act(() => {
    result.current.updateMessages(
      (messages) =>
        updateLastAssistantMessage(messages, (message) =>
          applyStreamingChunk(message, 'content', 'Hello back')
        ),
      sessionId
    )
  })

  expect(result.current.messages.at(-1)?.versions[0]?.content).toBe(
    'Hello back'
  )
  expect(result.current.messages.at(-1)?.status).toBe('streaming')
  await waitFor(
    () => expect(apiMocks.syncChatConversations).toHaveBeenCalled(),
    { timeout: 4_000 }
  )
})
