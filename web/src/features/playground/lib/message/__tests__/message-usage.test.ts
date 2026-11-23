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

import type { PricingModel } from '@/features/pricing/types'

import { parseStreamUsage } from '../../streaming/stream-utils'
import {
  estimateMessageUsageCostUSD,
  mergeChatCompletionUsage,
  normalizeMessageUsage,
} from '../message-usage-utils'

const model: PricingModel = {
  id: 1,
  model_name: 'gpt-test',
  quota_type: 0,
  model_ratio: 1,
  completion_ratio: 2,
  cache_ratio: 0.5,
  enable_groups: ['default'],
}

test('stream usage details are normalized for display and billing estimates', () => {
  const usage = normalizeMessageUsage(
    {
      prompt_tokens: 1_000_000,
      completion_tokens: 500_000,
      total_tokens: 1_500_000,
      prompt_tokens_details: {
        cached_tokens: 200_000,
        cache_write_tokens: 100_000,
        image_tokens: 25_000,
        audio_tokens: 5_000,
      },
      completion_tokens_details: {
        reasoning_tokens: 75_000,
      },
    },
    'gpt-test',
    'premium'
  )

  expect(usage).toMatchObject({
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    totalTokens: 1_500_000,
    cachedTokens: 200_000,
    cacheCreationTokens: 100_000,
    reasoningTokens: 75_000,
    imageTokens: 25_000,
    audioTokens: 5_000,
    model: 'gpt-test',
    group: 'premium',
  })
  expect(estimateMessageUsageCostUSD(usage, model, { premium: 1.5 })).toBe(5.7)
})

test('tiered token expressions are estimated from their unit prices', () => {
  const usage = normalizeMessageUsage(
    {
      prompt_tokens: 1_000_000,
      completion_tokens: 500_000,
      total_tokens: 1_500_000,
    },
    'tiered-model',
    'default'
  )

  expect(
    estimateMessageUsageCostUSD(
      usage,
      {
        ...model,
        model_name: 'tiered-model',
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("base", p * 0.03 + c * 0.06)',
      },
      { default: 1 }
    )
  ).toBeCloseTo(0.06)
})

test('stream parser keeps the terminal usage chunk', () => {
  expect(
    parseStreamUsage(
      JSON.stringify({
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-test',
        choices: [],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      })
    )
  ).toEqual({
    prompt_tokens: 3,
    completion_tokens: 2,
    total_tokens: 5,
  })
})

test('hidden context and memory calls aggregate into the visible usage', () => {
  const merged = mergeChatCompletionUsage(
    {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      cost: 0.001,
    },
    {
      prompt_tokens: 40,
      completion_tokens: 10,
      total_tokens: 50,
      cost: 0.0002,
    }
  )

  expect(merged).toMatchObject({
    prompt_tokens: 140,
    completion_tokens: 30,
    total_tokens: 170,
  })
  expect(merged?.cost).toBeCloseTo(0.0012)
})
