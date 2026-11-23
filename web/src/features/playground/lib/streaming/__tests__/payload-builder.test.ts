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

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../../constants'
import type { Message } from '../../../types'
import { createContextSummaryMessage } from '../../chat/context-compaction'
import { buildChatCompletionPayload } from '../payload-builder'

const messages: Message[] = [
  {
    key: 'user-1',
    from: 'user',
    versions: [{ id: 'version-1', content: 'Think carefully' }],
  },
]

test('forwards the selected reasoning effort with streaming usage enabled', () => {
  const payload = buildChatCompletionPayload(
    messages,
    { ...DEFAULT_CONFIG, reasoningEffort: 'high' },
    DEFAULT_PARAMETER_ENABLED
  )

  expect(payload.reasoning_effort).toBe('high')
  expect(payload.stream_options).toEqual({ include_usage: true })
})

test('omits reasoning effort when automatic selection is active', () => {
  const payload = buildChatCompletionPayload(
    messages,
    { ...DEFAULT_CONFIG, reasoningEffort: '' },
    DEFAULT_PARAMETER_ENABLED
  )

  expect(payload).not.toHaveProperty('reasoning_effort')
})

test('delegates web search execution to the backend', () => {
  const payload = buildChatCompletionPayload(
    messages,
    { ...DEFAULT_CONFIG, webSearch: true },
    DEFAULT_PARAMETER_ENABLED
  )

  expect(payload.web_search).toBe(true)
  expect(payload).not.toHaveProperty('tools')
})

test('sends only the latest context summary and newer messages', () => {
  const summary = createContextSummaryMessage('Earlier conversation summary', 2)
  const payload = buildChatCompletionPayload(
    [
      messages[0],
      summary,
      {
        key: 'user-2',
        from: 'user',
        versions: [{ id: 'version-2', content: 'Latest question' }],
      },
    ],
    DEFAULT_CONFIG,
    DEFAULT_PARAMETER_ENABLED
  )

  expect(payload.messages).toEqual([
    { role: 'system', content: 'Earlier conversation summary' },
    { role: 'user', content: 'Latest question' },
  ])
})
