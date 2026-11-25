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
import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import type { Message } from '../../types'
import { usePlaygroundConversation } from '../use-playground-conversation'

test('a sent request stays bound to its originating conversation', () => {
  const updateMessages = vi.fn()
  const sendChat = vi.fn()
  const ensureActiveSessionId = vi.fn(() => 'chat-1')
  const { result } = renderHook(() =>
    usePlaygroundConversation({
      ensureActiveSessionId,
      messages: [],
      sendChat,
      updateMessages,
    })
  )

  act(() => result.current.handleSendMessage('Hello'))

  expect(updateMessages).toHaveBeenCalledWith(expect.any(Array), 'chat-1')
  expect(sendChat).toHaveBeenCalledWith(expect.any(Array), 'chat-1')
})

test('regenerating an assistant response adds a new version and keeps the old one', () => {
  const updateMessages = vi.fn()
  const sendChat = vi.fn()
  const messages: Message[] = [
    {
      key: 'user-1',
      from: 'user',
      versions: [{ id: 'user-v1', content: 'Question' }],
    },
    {
      key: 'assistant-1',
      from: 'assistant',
      versions: [{ id: 'assistant-v1', content: 'First answer' }],
      activeVersionId: 'assistant-v1',
      status: 'complete',
    },
  ]
  const { result } = renderHook(() =>
    usePlaygroundConversation({
      ensureActiveSessionId: () => 'chat-1',
      messages,
      sendChat,
      updateMessages,
    })
  )

  act(() => result.current.handleRegenerateMessage(messages[1]))

  const nextMessages = updateMessages.mock.calls[0][0] as Message[]
  const regenerated = nextMessages[1]
  expect(regenerated.key).toBe('assistant-1')
  expect(regenerated.versions).toHaveLength(2)
  expect(regenerated.versions[0]).toMatchObject({
    id: 'assistant-v1',
    content: 'First answer',
    status: 'complete',
  })
  expect(regenerated.activeVersionId).toBe(regenerated.versions[1].id)
  expect(regenerated.status).toBe('loading')
  expect(sendChat).toHaveBeenCalledWith(nextMessages, 'chat-1')
})

test('switching response versions restores the selected version content', () => {
  const updateMessages = vi.fn()
  const message: Message = {
    key: 'assistant-1',
    from: 'assistant',
    versions: [
      {
        id: 'assistant-v1',
        content: 'First answer',
        status: 'complete',
      },
      {
        id: 'assistant-v2',
        content: 'Second answer',
        status: 'complete',
      },
    ],
    activeVersionId: 'assistant-v2',
    status: 'complete',
  }
  const { result } = renderHook(() =>
    usePlaygroundConversation({
      ensureActiveSessionId: () => 'chat-1',
      messages: [message],
      sendChat: vi.fn(),
      updateMessages,
    })
  )

  act(() => result.current.handleSwitchMessageVersion(message, 'assistant-v1'))

  const updater = updateMessages.mock.calls[0][0] as (
    messages: Message[]
  ) => Message[]
  const switched = updater([message])[0]
  expect(switched.activeVersionId).toBe('assistant-v1')
  expect(switched.versions[0].content).toBe('First answer')
  expect(switched.versions[1].content).toBe('Second answer')
  expect(switched.status).toBe('complete')
})
