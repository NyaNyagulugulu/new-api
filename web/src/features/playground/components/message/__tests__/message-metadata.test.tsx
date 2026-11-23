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
import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { beforeAll, expect, test, vi } from 'vitest'

import type { Message } from '../../../types'
import { MessageMetadata } from '../message-metadata'

vi.mock('@/features/pricing/hooks/use-pricing-data', () => ({
  usePricingData: () => ({
    models: [
      {
        id: 1,
        model_name: 'gpt-test',
        quota_type: 0,
        model_ratio: 1,
        completion_ratio: 2,
        cache_ratio: 0.5,
        enable_groups: ['default'],
        group_ratio: { default: 1 },
      },
    ],
    groupRatio: { default: 1 },
  }),
}))

const message: Message = {
  key: 'assistant-1',
  from: 'assistant',
  versions: [{ id: 'version-1', content: 'Answer' }],
  createdAt: Date.now(),
  status: 'complete',
  usage: {
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    cachedTokens: 200,
    cacheCreationTokens: 0,
    reasoningTokens: 100,
    imageTokens: 0,
    audioTokens: 0,
    model: 'gpt-test',
    group: 'default',
    reasoningEffort: 'high',
  },
}

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', {
    'Cached tokens': 'Cached tokens',
    Cost: 'Cost',
    'Input tokens': 'Input tokens',
    'Output tokens': 'Output tokens',
    'Response time: {{duration}}': 'Response time: {{duration}}',
    'Total tokens': 'Total tokens',
  })
})

test('shows input, output, total, cached, reasoning tokens and estimated cost', () => {
  render(<MessageMetadata alignment='left' message={message} />)

  expect(screen.getByText('Input tokens:')).toBeInTheDocument()
  expect(screen.getByText('1,000')).toBeInTheDocument()
  expect(screen.getByText('Output tokens:')).toBeInTheDocument()
  expect(screen.getByText('500')).toBeInTheDocument()
  expect(screen.getByText('Total tokens:')).toBeInTheDocument()
  expect(screen.getByText('1,500')).toBeInTheDocument()
  expect(screen.getByText('Cached tokens:')).toBeInTheDocument()
  expect(screen.getByText('Cost:')).toBeInTheDocument()
})
