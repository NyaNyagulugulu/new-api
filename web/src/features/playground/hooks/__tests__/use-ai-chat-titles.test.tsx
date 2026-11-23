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

import { appendUserMessagePair, updateLastAssistantMessage } from '../../lib'
import type { ChatCompletionResponse } from '../../types'
import { useAiChatTitles } from '../use-ai-chat-titles'
import { usePlaygroundState } from '../use-playground-state'

const apiMocks = vi.hoisted(() => ({
  deleteChatConversation: vi.fn(),
  getChatConversations: vi.fn(),
  sendChatCompletion: vi.fn(),
  syncChatConversations: vi.fn(),
}))

vi.mock('../../api', () => ({
  deleteChatConversation: apiMocks.deleteChatConversation,
  getChatConversations: apiMocks.getChatConversations,
  sendChatCompletion: apiMocks.sendChatCompletion,
  syncChatConversations: apiMocks.syncChatConversations,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  apiMocks.getChatConversations.mockResolvedValue([])
  apiMocks.syncChatConversations.mockResolvedValue(undefined)
  apiMocks.deleteChatConversation.mockResolvedValue(undefined)
  useAuthStore.getState().auth.reset()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'A', role: 1 })
})

function useTitleHarness() {
  const state = usePlaygroundState()
  useAiChatTitles({
    config: state.config,
    isLoadingMessages: state.isLoadingMessages,
    sessions: state.sessions,
    renameChat: state.renameChat,
  })
  return state
}

test('persists a fallback title and accepts a reasoning-only title response', async () => {
  const titleResponse = deferred<ChatCompletionResponse>()
  apiMocks.sendChatCompletion.mockReturnValue(titleResponse.promise)
  const { result } = renderHook(() => useTitleHarness())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))

  let sessionId = ''
  act(() => {
    sessionId = result.current.ensureActiveSessionId()
    const messages = appendUserMessagePair([], 'Explain database indexes')
    result.current.updateMessages(
      updateLastAssistantMessage(messages, (message) => ({
        ...message,
        versions: [
          { id: message.versions[0].id, content: 'Indexes speed up lookups.' },
        ],
        status: 'complete',
      })),
      sessionId
    )
  })

  await waitFor(() =>
    expect(
      result.current.sessions.find((session) => session.id === sessionId)?.title
    ).toBe('Explain database indexes')
  )
  expect(apiMocks.sendChatCompletion).toHaveBeenCalledWith(
    expect.objectContaining({ max_tokens: 512 })
  )

  await act(async () => {
    titleResponse.resolve({
      id: 'chatcmpl-title',
      object: 'chat.completion',
      created: 0,
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            reasoning_content: 'Database indexing basics',
          },
          finish_reason: 'stop',
        },
      ],
    })
    await titleResponse.promise
  })

  await waitFor(() =>
    expect(
      result.current.sessions.find((session) => session.id === sessionId)?.title
    ).toBe('Database indexing basics')
  )
})
