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
  ImportedChatSession,
  Message,
} from '../../types'
import { useChatHandler } from '../use-chat-handler'
import { usePlaygroundState } from '../use-playground-state'

const apiMocks = vi.hoisted(() => ({
  createEmbeddings: vi.fn(),
  deleteChatConversation: vi.fn(),
  getChatConversation: vi.fn(),
  getChatConversations: vi.fn(),
  searchUserMemories: vi.fn(),
  sendChatCompletion: vi.fn(),
  syncChatConversations: vi.fn(),
}))

vi.mock('../../api', () => ({
  createEmbeddings: apiMocks.createEmbeddings,
  deleteChatConversation: apiMocks.deleteChatConversation,
  getChatConversation: apiMocks.getChatConversation,
  getChatConversations: apiMocks.getChatConversations,
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
  apiMocks.getChatConversations.mockResolvedValue({
    sessions: [],
    page: 1,
    pageSize: 30,
    total: 0,
    hasMore: false,
  })
  apiMocks.getChatConversation.mockRejectedValue(
    new Error('Conversation not found')
  )
  apiMocks.createEmbeddings.mockResolvedValue([[1, 0, 0]])
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

test('streaming content does not repeatedly change conversation recency', async () => {
  const { result } = renderHook(() => usePlaygroundState())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))

  let sessionId = ''
  act(() => {
    sessionId = result.current.ensureActiveSessionId()
    result.current.updateMessages(appendUserMessagePair([], 'Hello'), sessionId)
  })
  const updatedAt = result.current.sessions.find(
    (session) => session.id === sessionId
  )?.updatedAt

  act(() => {
    result.current.updateMessages(
      (messages) =>
        updateLastAssistantMessage(messages, (message) =>
          applyStreamingChunk(message, 'content', 'Streaming')
        ),
      sessionId
    )
  })

  expect(
    result.current.sessions.find((session) => session.id === sessionId)
      ?.updatedAt
  ).toBe(updatedAt)
})

test('opens a conversation from its permalink session id', async () => {
  const conversationId = '6b062a5d-40e4-83e8-a783-5a6675934b43'
  const { result } = renderHook(() => usePlaygroundState(conversationId))
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))

  expect(result.current.activeSession?.id).toBe(conversationId)
  expect(result.current.sessions.map((session) => session.id)).toContain(
    conversationId
  )
})

test('loads messages only for the selected conversation', async () => {
  const summaries = [
    {
      id: 'chat-1',
      title: 'First chat',
      personaId: 0,
      messages: [],
      messagesLoaded: false,
      createdAt: 100,
      updatedAt: 200,
    },
    {
      id: 'chat-2',
      title: 'Second chat',
      personaId: 0,
      messages: [],
      messagesLoaded: false,
      createdAt: 300,
      updatedAt: 400,
    },
  ]
  apiMocks.getChatConversations.mockResolvedValue({
    sessions: summaries,
    page: 1,
    pageSize: 30,
    total: 2,
    hasMore: false,
  })
  apiMocks.getChatConversation.mockImplementation((id: string) => {
    const summary = summaries.find((session) => session.id === id)
    return Promise.resolve({
      ...summary,
      messages: appendUserMessagePair([], `Message for ${id}`),
      messagesLoaded: true,
      createdAt: 1,
      updatedAt: 1,
    })
  })

  const { result } = renderHook(() => usePlaygroundState())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))

  expect(apiMocks.getChatConversation).toHaveBeenCalledTimes(1)
  expect(apiMocks.getChatConversation).toHaveBeenCalledWith('chat-2')
  expect(result.current.messages[0]?.versions[0]?.content).toBe(
    'Message for chat-2'
  )

  act(() => result.current.selectChat('chat-1'))
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))

  expect(apiMocks.getChatConversation).toHaveBeenCalledTimes(2)
  expect(apiMocks.getChatConversation).toHaveBeenLastCalledWith('chat-1')
  expect(result.current.messages[0]?.versions[0]?.content).toBe(
    'Message for chat-1'
  )
  expect(result.current.sessions.map((session) => session.id)).toEqual([
    'chat-2',
    'chat-1',
  ])
  expect(result.current.sessions.map((session) => session.updatedAt)).toEqual([
    400, 200,
  ])
})

test('loads additional history metadata page by page', async () => {
  apiMocks.getChatConversations
    .mockResolvedValueOnce({
      sessions: [
        {
          id: 'chat-1',
          title: 'First chat',
          personaId: 0,
          messages: [],
          messagesLoaded: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      page: 1,
      pageSize: 30,
      total: 2,
      hasMore: true,
    })
    .mockResolvedValueOnce({
      sessions: [
        {
          id: 'chat-2',
          title: 'Second chat',
          personaId: 0,
          messages: [],
          messagesLoaded: false,
          createdAt: 3,
          updatedAt: 4,
        },
      ],
      page: 2,
      pageSize: 30,
      total: 2,
      hasMore: false,
    })
  apiMocks.getChatConversation.mockResolvedValue({
    id: 'chat-1',
    title: 'First chat',
    personaId: 0,
    messages: [
      {
        key: 'message-chat-1',
        from: 'user',
        versions: [{ id: 'version-chat-1', content: 'Loaded first chat' }],
        createdAt: 2,
      },
    ],
    messagesLoaded: true,
    createdAt: 1,
    updatedAt: 2,
  })

  const { result } = renderHook(() => usePlaygroundState())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))
  expect(result.current.hasMoreSessions).toBe(true)
  expect(result.current.sessions).toHaveLength(1)

  await act(async () => {
    await result.current.loadMoreSessions()
  })

  expect(apiMocks.getChatConversations).toHaveBeenLastCalledWith(2, 30)
  expect(result.current.sessions.map((session) => session.id)).toEqual([
    'chat-2',
    'chat-1',
  ])
  expect(result.current.hasMoreSessions).toBe(false)
})

test('renaming a conversation does not change its latest-message time', async () => {
  apiMocks.getChatConversations.mockResolvedValue({
    sessions: [
      {
        id: 'chat-1',
        title: '',
        personaId: 0,
        messages: [],
        messagesLoaded: false,
        createdAt: 100,
        updatedAt: 200,
      },
    ],
    page: 1,
    pageSize: 30,
    total: 1,
    hasMore: false,
  })
  apiMocks.getChatConversation.mockResolvedValue({
    id: 'chat-1',
    title: '',
    personaId: 0,
    messages: appendUserMessagePair([], 'Existing question'),
    messagesLoaded: true,
    createdAt: 100,
    updatedAt: 200,
  })
  const { result } = renderHook(() => usePlaygroundState())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))
  const updatedAtBeforeRename = result.current.sessions[0].updatedAt

  act(() => result.current.renameChat('chat-1', 'Renamed chat'))

  expect(result.current.sessions[0]).toMatchObject({
    id: 'chat-1',
    title: 'Renamed chat',
    updatedAt: updatedAtBeforeRename,
  })
})

test('changing a persona updates the active conversation persona', async () => {
  const { result } = renderHook(() => usePlaygroundState())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))

  let sessionId = ''
  act(() => {
    sessionId = result.current.ensureActiveSessionId()
  })
  act(() => result.current.selectPersona(7))

  expect(
    result.current.sessions.find((session) => session.id === sessionId)
      ?.personaId
  ).toBe(7)
})

test('imports conversations into the selected persona ordered by latest message', async () => {
  const { result } = renderHook(() => usePlaygroundState())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))

  let newestId = ''
  act(() => {
    newestId =
      result.current.importConversations(
        [
          {
            id: 'imported-older',
            title: 'Older conversation',
            messages: [
              {
                key: 'older-message',
                from: 'user',
                versions: [{ id: 'older-version', content: 'Older message' }],
              },
            ],
            createdAt: 1_000,
            updatedAt: 2_000,
          },
          {
            id: 'imported-newer',
            title: 'Newer conversation',
            messages: [
              {
                key: 'newer-message',
                from: 'user',
                versions: [{ id: 'newer-version', content: 'Newest message' }],
              },
            ],
            createdAt: 3_000,
            updatedAt: 4_000,
          },
        ],
        7
      ) ?? ''
  })

  expect(result.current.sessions.map((session) => session.id)).toEqual([
    'imported-newer',
    'imported-older',
  ])
  expect(result.current.sessions.map((session) => session.personaId)).toEqual([
    7, 7,
  ])
  expect(newestId).toBe('imported-newer')
  expect(result.current.activeSession?.id).toBe('imported-newer')
})

test('syncs every imported conversation across multiple batches', async () => {
  apiMocks.syncChatConversations.mockClear()
  const { result } = renderHook(() => usePlaygroundState())
  await waitFor(() => expect(result.current.isLoadingMessages).toBe(false))
  const importedSessions: ImportedChatSession[] = Array.from(
    { length: 55 },
    (_, index) => ({
      id: `imported-${index}`,
      title: `Imported ${index}`,
      messages: [
        {
          key: `message-${index}`,
          from: 'user',
          versions: [{ id: `version-${index}`, content: `Message ${index}` }],
        },
      ],
      createdAt: index,
      updatedAt: index,
    })
  )

  act(() => {
    result.current.importConversations(importedSessions, 0)
  })

  expect(result.current.sessions).toHaveLength(55)
  expect(result.current.visibleSessions).toHaveLength(30)
  expect(result.current.hasMoreSessions).toBe(true)
  await act(async () => {
    await result.current.loadMoreSessions()
  })
  expect(result.current.visibleSessions).toHaveLength(55)
  expect(result.current.hasMoreSessions).toBe(false)

  await waitFor(
    () => expect(apiMocks.syncChatConversations).toHaveBeenCalledTimes(2),
    { timeout: 5_000 }
  )
  const batchSizes = apiMocks.syncChatConversations.mock.calls.map(
    (call: unknown[]) => (call[0] as unknown[]).length
  )
  expect(batchSizes.sort()).toEqual([5, 50])
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

test('web search is delegated to the backend and keeps the reasoning stream', async () => {
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
  const [, payload, onUpdate, onComplete, , onWebSearch] = streamCall as [
    string,
    ChatCompletionRequest,
    (type: 'reasoning' | 'content', chunk: string) => void,
    (usage?: ChatCompletionUsage) => void,
    (error: string, errorCode?: string) => void,
    (status: 'used', sources: Array<{ href: string; title: string }>) => void,
  ]

  expect(payload.web_search).toBe(true)
  expect(result.current.messages.at(-1)?.webSearch?.status).toBe('searching')

  act(() => {
    onWebSearch('used', [
      { href: 'https://go.dev/doc/devel/release', title: 'Go releases' },
    ])
    onUpdate('reasoning', 'Checking the official download page.')
    onUpdate('content', 'Go 1.25 is available.')
    onComplete()
  })

  const assistantMessage = result.current.messages.at(-1)
  expect(assistantMessage?.reasoning?.content).toBe(
    'Checking the official download page.'
  )
  expect(assistantMessage?.versions[0]?.content).toBe('Go 1.25 is available.')
  expect(assistantMessage?.webSearch?.status).toBe('used')
  expect(assistantMessage?.sources).toEqual([
    { href: 'https://go.dev/doc/devel/release', title: 'Go releases' },
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
