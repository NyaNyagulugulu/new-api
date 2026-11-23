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

import type { ChatCompletionRequest, UserMemory } from '../../../types'
import {
  addLongTermMemoryContext,
  extractExplicitMemoryInputs,
  parseExtractedMemories,
} from '../long-term-memory'

test('injects relevant long-term memories within the configured budget', () => {
  const memories: UserMemory[] = [
    {
      id: 1,
      content: 'The user prefers PostgreSQL.',
      keywords: 'database',
      category: 'preference',
      importance: 0.9,
      conversation_id: '',
      source_key: '',
      status: 'active',
      created_at: 1,
      updated_at: 1,
    },
  ]
  const payload: ChatCompletionRequest = {
    model: 'test-model',
    messages: [{ role: 'user', content: 'Which database should we use?' }],
    stream: true,
  }

  const updated = addLongTermMemoryContext(payload, memories, 1_000)

  expect(payload.messages[0].content).toBe('Which database should we use?')
  expect(updated.messages[0].content).toContain('The user prefers PostgreSQL.')
})

test('parses a fenced JSON memory extraction response', () => {
  const memories = parseExtractedMemories(`\`\`\`json
[
  {
    "content": "The user prefers concise answers.",
    "keywords": ["style", "concise"],
    "category": "preference",
    "importance": 0.86
  }
]
\`\`\``)

  expect(memories).toEqual([
    {
      content: 'The user prefers concise answers.',
      keywords: ['style', 'concise'],
      category: 'preference',
      importance: 0.86,
      conversation_id: '',
      source_key: '',
    },
  ])
})

test('captures explicit identity and preference requests immediately', () => {
  const memories = extractExplicitMemoryInputs(
    [
      {
        key: 'user-1',
        from: 'user',
        versions: [{ id: 'v1', content: '以后你就叫哈基米了' }],
      },
    ],
    'chat-1',
    'chat-1:assistant-1'
  )

  expect(memories).toEqual([
    expect.objectContaining({
      content: '以后你就叫哈基米了',
      category: 'preference',
      importance: 0.9,
      conversation_id: 'chat-1',
    }),
  ])
})
