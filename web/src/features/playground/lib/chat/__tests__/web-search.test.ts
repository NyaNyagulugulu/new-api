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

import type { ChatCompletionRequest, Message } from '../../../types'
import {
  addWebSearchContext,
  extractWebSearchResults,
  getWebSearchQuery,
} from '../web-search'

const messages: Message[] = [
  {
    key: 'user-1',
    from: 'user',
    versions: [{ id: 'version-1', content: 'What is the latest Go release?' }],
  },
]

test('extracts safe, unique sources from DeepSeek search results', () => {
  const results = extractWebSearchResults({
    results: [
      {
        title: 'Go Downloads',
        url: 'https://go.dev/dl/',
        content: 'Download the latest Go release.',
      },
      {
        title: 'Duplicate',
        url: 'https://go.dev/dl/',
      },
      {
        title: 'Unsafe',
        url: 'javascript:alert(1)',
      },
    ],
  })

  expect(results).toEqual([
    {
      title: 'Go Downloads',
      url: 'https://go.dev/dl/',
      snippet: 'Download the latest Go release.',
    },
  ])
})

test('adds search results to the latest user message without mutating it', () => {
  const payload: ChatCompletionRequest = {
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'What is the latest Go release?' }],
    stream: true,
  }
  const updated = addWebSearchContext(payload, [
    {
      title: 'Go Downloads',
      url: 'https://go.dev/dl/',
      snippet: 'Download the latest Go release.',
    },
  ])

  expect(payload.messages[0].content).toBe('What is the latest Go release?')
  expect(updated.messages[0].content).toContain('Web search results')
  expect(updated.messages[0].content).toContain('https://go.dev/dl/')
})

test('uses the latest user message as the search query', () => {
  expect(
    getWebSearchQuery([
      ...messages,
      {
        key: 'assistant-1',
        from: 'assistant',
        versions: [{ id: 'version-2', content: 'A previous answer' }],
      },
      {
        key: 'user-2',
        from: 'user',
        versions: [{ id: 'version-3', content: '  Search this  ' }],
      },
    ])
  ).toBe('Search this')
})
