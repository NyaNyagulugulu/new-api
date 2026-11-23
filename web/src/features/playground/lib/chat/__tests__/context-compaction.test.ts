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

import type { Message } from '../../../types'
import {
  createContextSummaryMessage,
  estimateContextTokens,
  getEffectiveContextMessages,
  insertContextSummaryMessage,
  planContextCompaction,
  shouldCompactContext,
} from '../context-compaction'

function createTextMessage(
  key: string,
  from: 'user' | 'assistant',
  content: string
): Message {
  return {
    key,
    from,
    versions: [{ id: `${key}-version`, content }],
    status: from === 'assistant' ? 'complete' : undefined,
  }
}

test('compacts after the estimated context crosses the model threshold', () => {
  const messages = [
    createTextMessage('user-1', 'user', 'a'.repeat(8_000)),
    createTextMessage('assistant-1', 'assistant', 'b'.repeat(8_000)),
    createTextMessage('user-2', 'user', 'c'.repeat(8_000)),
    createTextMessage('assistant-2', 'assistant', 'd'.repeat(8_000)),
    createTextMessage('user-3', 'user', 'latest question'),
  ]

  expect(estimateContextTokens(messages)).toBeGreaterThan(4_000)
  expect(shouldCompactContext(messages, 5_000)).toBe(true)

  const plan = planContextCompaction(messages, 5_000)
  expect(plan?.sourceMessages.length).toBeGreaterThan(0)
  expect(plan?.firstKeptMessageKey).toBe('user-2')
})

test('keeps only the latest summary and subsequent messages in API context', () => {
  const messages = [
    createTextMessage('user-1', 'user', 'old'),
    createTextMessage('assistant-1', 'assistant', 'old answer'),
    createTextMessage('user-2', 'user', 'recent'),
    createTextMessage('assistant-2', 'assistant', 'recent answer'),
  ]
  const summary = createContextSummaryMessage('Stored summary', 100)
  const compacted = insertContextSummaryMessage(messages, summary, 'user-2')
  const effective = getEffectiveContextMessages(compacted)

  expect(compacted.filter((message) => message.isContextSummary)).toHaveLength(
    1
  )
  expect(effective.map((message) => message.key)).toEqual([
    summary.key,
    'user-2',
    'assistant-2',
  ])
})
