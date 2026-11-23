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

import { createChatSession } from '../chat-sessions'
import {
  buildChatTitlePrompt,
  canGenerateChatTitle,
  extractChatTitle,
} from '../chat-title'

const conversation = createChatSession(
  [
    {
      key: 'user-1',
      from: 'user',
      versions: [{ id: 'v1', content: 'Explain database indexes' }],
    },
    {
      key: 'assistant-1',
      from: 'assistant',
      versions: [{ id: 'v2', content: 'Indexes speed up lookups.' }],
      status: 'complete',
    },
  ],
  100,
  'chat-1'
)

test('generates a title only after an assistant reply completes', () => {
  expect(canGenerateChatTitle(conversation)).toBe(true)
  expect(
    canGenerateChatTitle({
      ...conversation,
      messages: conversation.messages.slice(0, 1),
    })
  ).toBe(false)
  expect(canGenerateChatTitle({ ...conversation, title: 'Manual title' })).toBe(
    false
  )
})

test('normalizes the model title to one concise line', () => {
  expect(extractChatTitle('**"Database indexing basics."**')).toBe(
    'Database indexing basics'
  )
  expect(extractChatTitle('First line\nSecond line')).toBe('First line')
})

test('includes both sides of the first exchange in the title prompt', () => {
  const prompt = buildChatTitlePrompt(conversation)

  expect(prompt).toContain('User: Explain database indexes')
  expect(prompt).toContain('Assistant: Indexes speed up lookups.')
  expect(prompt).toContain('Return only the title')
})
