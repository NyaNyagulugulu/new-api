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
import type {
  ChatCompletionRequest,
  ChatCompletionUsage,
  Message,
} from '../../types'
import { useChatHandler } from '../use-chat-handler'
import { usePlaygroundState } from '../use-playground-state'

const apiMocks = vi.hoisted(() => ({
  deleteChatConversation: vi.fn(),
  getChatConversations: vi.fn(),
  searchWeb: vi.fn(),
  searchUserMemories: vi.fn(),
  sendChatCompletion: vi.fn(),
  syncChatConversations: vi.fn(),
}))

vi.mock('../../api', () => ({
  deleteChatConversation: apiMocks.deleteChatConversation,
  getChatConversations: apiMocks.getChatConversations,
  searchWeb: apiMocks.searchWeb,
  searchUserMemories: apiMocks.searchUserMemories,
  sendChatCompletion: apiMocks.sendChatCompletion,
  syncChatConversations: apiMocks.syncChatConversations,
}))

const streamMocks = vi.hoisted(() => ({
  sendStreamRequest: vi.fn(),
  stopStream: vi.fn(),
}))

vi.mock('../use-stream-request', () => ({
  useStreamRequest: () => ({
    sendStreamRequest: streamMocks.sendStreamRequest,
    stopStream: streamMocks.stopStream,
  }),
}))

beforeEach(() => {
  localStorage.clear()
  apiMocks.getChatConversations.mockResolvedValue([])
  apiMocks.searchWeb.mockResolvedValue([])
  apiMocks.searchUserMemories.mockResolvedValue([])
  apiMocks.syncChatConversations.mockResolvedValue([])
  apiMocks.deleteChatConversation.mockResolvedValue(undefined)
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

function usePlaygroundHarness(contextWindowTokens?: number) {
  const state = usePlaygroundState()
  const chat = useChatHandler({
    config: state.config,
    contextWindowTokens,
    parameterEnabled: state.parameterEnabled,
    onMessageUpdate: state.updateMessages,
  })
  return { ...state, ...chat }
}

test('final streamed chunks are committed when completion arrives immediately', async () => {
  const { result } = renderHook(() => usePlaygroundHarness())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))

  let sessionId = ''
  let messages: Message[] = []
  act(() => {
    sessionId = result.current.ensureActiveSessionId()
    messages = appendUserMessagePair([], 'Hello')
    result.current.updateMessages(messages, sessionId)
    result.current.sendChat(messages, sessionId)
  })
  expect(result.current.messages.at(-1)?.model).toBe(
    result.current.config.model
  )

  const streamCall = streamMocks.sendStreamRequest.mock.calls.at(-1)
  expect(streamCall).toBeDefined()
  if (!streamCall) return

  const [, , onUpdate, onComplete] = streamCall as [
    string,
    ChatCompletionRequest,
    (type: 'reasoning' | 'content', chunk: string) => void,
    (usage?: ChatCompletionUsage) => void,
    (error: string, errorCode?: string) => void,
  ]

  act(() => {
    onUpdate('content', 'Hello back')
    onComplete({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 })
  })

  const assistantMessage = result.current.messages.at(-1)
  expect(assistantMessage?.versions[0]?.content).toBe('Hello back')
  expect(assistantMessage?.status).toBe('complete')
  expect(assistantMessage?.usage?.totalTokens).toBe(5)
})

test('web search keeps the normal reasoning stream and attaches sources', async () => {
  apiMocks.searchWeb.mockResolvedValue([
    {
      title: 'Go Downloads',
      url: 'https://go.dev/dl/',
      snippet: 'Download Go.',
    },
  ])
  const { result } = renderHook(() => usePlaygroundHarness())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))
  act(() => result.current.updateConfig('webSearch', true))
  await waitFor(() => expect(result.current.config.webSearch).toBe(true))

  let sessionId = ''
  let messages: Message[] = []
  act(() => {
    sessionId = result.current.ensureActiveSessionId()
    messages = appendUserMessagePair([], 'What is the latest Go release?')
    result.current.updateMessages(messages, sessionId)
    result.current.sendChat(messages, sessionId)
  })

  await waitFor(() => expect(streamMocks.sendStreamRequest).toHaveBeenCalled())
  const streamCall = streamMocks.sendStreamRequest.mock.calls.at(-1)
  if (!streamCall) throw new Error('stream call not found')
  const [, payload, onUpdate, onComplete] = streamCall as [
    string,
    ChatCompletionRequest,
    (type: 'reasoning' | 'content', chunk: string) => void,
    (usage?: ChatCompletionUsage) => void,
    (error: string, errorCode?: string) => void,
  ]

  expect(apiMocks.searchWeb).toHaveBeenCalledWith(
    'What is the latest Go release?',
    result.current.config.group,
    expect.any(AbortSignal)
  )
  expect(JSON.stringify(payload.messages)).toContain('https://go.dev/dl/')
  expect(payload).not.toHaveProperty('tools')

  act(() => {
    onUpdate('reasoning', 'Checking the official download page.')
    onUpdate('content', 'Go 1.25 is available.')
    onComplete()
  })

  const assistantMessage = result.current.messages.at(-1)
  expect(assistantMessage?.reasoning?.content).toBe(
    'Checking the official download page.'
  )
  expect(assistantMessage?.versions[0]?.content).toBe('Go 1.25 is available.')
  expect(assistantMessage?.sources).toEqual([
    { href: 'https://go.dev/dl/', title: 'Go Downloads' },
  ])
})

test('automatically summarizes older context before starting the answer', async () => {
  apiMocks.sendChatCompletion.mockResolvedValue({
    id: 'chatcmpl-summary',
    object: 'chat.completion',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Earlier messages discussed the release plan.',
        },
        finish_reason: 'stop',
      },
    ],
  })
  const { result } = renderHook(() => usePlaygroundHarness(5_000))
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))

  let sessionId = ''
  let messages: Message[] = []
  act(() => {
    sessionId = result.current.ensureActiveSessionId()
    messages = [
      {
        key: 'old-user',
        from: 'user',
        versions: [{ id: 'old-user-version', content: 'a'.repeat(20000) }],
      },
      {
        key: 'old-assistant',
        from: 'assistant',
        versions: [{ id: 'old-assistant-version', content: 'b'.repeat(20000) }],
        status: 'complete',
      },
      {
        key: 'recent-user',
        from: 'user',
        versions: [{ id: 'recent-user-version', content: 'Recent question' }],
      },
      ...appendUserMessagePair([], 'Latest question'),
    ]
    result.current.updateMessages(messages, sessionId)
    result.current.sendChat(messages, sessionId)
  })

  await waitFor(() => expect(apiMocks.sendChatCompletion).toHaveBeenCalled())
  await waitFor(() =>
    expect(result.current.messages.some((message) => message.isContextSummary))
  )

  const streamCall = streamMocks.sendStreamRequest.mock.calls.at(-1)
  if (!streamCall) throw new Error('stream call not found')
  const [, payload] = streamCall as [
    string,
    ChatCompletionRequest,
    (type: 'reasoning' | 'content', chunk: string) => void,
    (usage?: ChatCompletionUsage) => void,
    (error: string, errorCode?: string) => void,
  ]

  expect(payload.messages[0]).toMatchObject({
    role: 'system',
    content: 'Earlier messages discussed the release plan.',
  })
  expect(JSON.stringify(payload.messages)).not.toContain('a'.repeat(100))
})
