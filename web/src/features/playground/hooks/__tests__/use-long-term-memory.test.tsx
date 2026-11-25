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
import { renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { DEFAULT_CONFIG } from '../../constants'
import type { ChatSession, MemorySettings } from '../../types'
import { useLongTermMemoryReflection } from '../use-long-term-memory'

const apiMocks = vi.hoisted(() => ({
  createEmbeddings: vi.fn(),
  getMemorySettings: vi.fn(),
  saveUserMemories: vi.fn(),
  sendChatCompletion: vi.fn(),
}))

vi.mock('../../api', () => ({
  createEmbeddings: apiMocks.createEmbeddings,
  getMemorySettings: apiMocks.getMemorySettings,
  saveUserMemories: apiMocks.saveUserMemories,
  sendChatCompletion: apiMocks.sendChatCompletion,
}))

const settings: MemorySettings = {
  enabled: true,
  auto_extract: true,
  extract_every_rounds: 1,
  extract_window_messages: 10,
  retrieve_limit: 5,
  max_injected_chars: 3_000,
  min_importance: 0.2,
  retention_days: 365,
  embedding_enabled: false,
  embedding_model: 'embedding-test',
  embedding_group: 'default',
  min_similarity: 0.4,
  vector_weight: 0.5,
}

function createSession(answer: string, key: string): ChatSession {
  return {
    id: 'chat-1',
    title: 'Chat',
    personaId: 9,
    createdAt: 1,
    updatedAt: 2,
    messages: [
      {
        key: `${key}-user`,
        from: 'user',
        versions: [{ id: `${key}-user-v`, content: 'Question' }],
      },
      {
        key: `${key}-assistant`,
        from: 'assistant',
        versions: [{ id: `${key}-assistant-v`, content: answer }],
        status: 'complete',
      },
    ],
  }
}

function createEmptySession(): ChatSession {
  return {
    id: 'chat-1',
    title: 'Chat',
    personaId: 0,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  }
}

test('extracts and saves memories after the configured number of replies', async () => {
  apiMocks.sendChatCompletion.mockResolvedValue({
    choices: [
      {
        message: {
          content:
            '[{"content":"The user prefers concise answers.","keywords":["style"],"category":"preference","importance":0.9}]',
        },
      },
    ],
  })
  apiMocks.saveUserMemories.mockResolvedValue(undefined)
  const { rerender } = renderHook(
    ({ sessions }) =>
      useLongTermMemoryReflection({
        config: DEFAULT_CONFIG,
        sessions,
        settings,
      }),
    {
      initialProps: {
        sessions: [createEmptySession()],
      },
    }
  )

  rerender({ sessions: [createSession('First answer', 'one')] })

  await waitFor(() => expect(apiMocks.saveUserMemories).toHaveBeenCalled())
  expect(apiMocks.saveUserMemories).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        content: 'The user prefers concise answers.',
        persona_id: 9,
        conversation_id: 'chat-1',
        source_key: 'chat-1:one-assistant',
      }),
    ],
    'default'
  )
})

test('does not extract memories from conversation history loaded on open', () => {
  apiMocks.sendChatCompletion.mockResolvedValue({ choices: [] })

  renderHook(() =>
    useLongTermMemoryReflection({
      config: DEFAULT_CONFIG,
      sessions: [createSession('Existing answer', 'existing')],
      settings,
    })
  )

  expect(apiMocks.sendChatCompletion).not.toHaveBeenCalled()
  expect(apiMocks.saveUserMemories).not.toHaveBeenCalled()
})
