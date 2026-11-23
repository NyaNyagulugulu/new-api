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
import type { PricingModel } from '@/features/pricing/types'

import type { ChatCompletionUsage, MessageUsage } from '../../types'

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0
}

function reportedCost(value: unknown): number | undefined {
  let parsed = Number.NaN
  if (typeof value === 'number') {
    parsed = value
  } else if (typeof value === 'string') {
    parsed = Number.parseFloat(value)
  }
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export function normalizeMessageUsage(
  usage: ChatCompletionUsage,
  model?: string,
  group?: string
): MessageUsage {
  const promptDetails = usage.prompt_tokens_details
  const completionDetails = usage.completion_tokens_details
  const inputDetails = usage.input_tokens_details
  const outputDetails = usage.output_tokens_details
  const inputTokens = numberValue(usage.prompt_tokens ?? usage.input_tokens)
  const outputTokens = numberValue(
    usage.completion_tokens ?? usage.output_tokens
  )

  return {
    inputTokens,
    outputTokens,
    totalTokens: numberValue(usage.total_tokens) || inputTokens + outputTokens,
    cachedTokens: numberValue(
      promptDetails?.cached_tokens ?? inputDetails?.cached_tokens
    ),
    cacheCreationTokens: Math.max(
      numberValue(promptDetails?.cache_write_tokens),
      numberValue(promptDetails?.cached_creation_tokens),
      numberValue(promptDetails?.cache_creation_input_tokens),
      numberValue(inputDetails?.cache_write_tokens),
      numberValue(inputDetails?.cached_creation_tokens),
      numberValue(inputDetails?.cache_creation_input_tokens)
    ),
    reasoningTokens: numberValue(
      completionDetails?.reasoning_tokens ?? outputDetails?.reasoning_tokens
    ),
    imageTokens:
      numberValue(promptDetails?.image_tokens) +
      numberValue(completionDetails?.image_tokens) +
      numberValue(inputDetails?.image_tokens) +
      numberValue(outputDetails?.image_tokens),
    audioTokens:
      numberValue(promptDetails?.audio_tokens) +
      numberValue(completionDetails?.audio_tokens) +
      numberValue(inputDetails?.audio_tokens) +
      numberValue(outputDetails?.audio_tokens),
    model,
    group,
    reportedCostUSD: reportedCost(usage.cost),
  }
}

function resolveGroupRatio(
  model: PricingModel,
  group: string | undefined,
  groupRatios: Record<string, number>
): number {
  const modelRatio = group ? model.group_ratio?.[group] : undefined
  if (typeof modelRatio === 'number' && Number.isFinite(modelRatio)) {
    return modelRatio
  }

  const configuredRatio = group ? groupRatios[group] : undefined
  return typeof configuredRatio === 'number' && Number.isFinite(configuredRatio)
    ? configuredRatio
    : 1
}

/**
 * Estimate the request cost in USD from the same ratio fields used by the
 * token billing calculator. Actual settlement remains authoritative.
 */
export function estimateMessageUsageCostUSD(
  usage: MessageUsage,
  model: PricingModel | undefined,
  groupRatios: Record<string, number>
): number | null {
  if (!model) return usage.reportedCostUSD ?? null
  if (model.billing_mode === 'tiered_expr') return usage.reportedCostUSD ?? null

  const groupRatio = resolveGroupRatio(model, usage.group, groupRatios)

  if (model.quota_type === 1) {
    return Math.max(0, (model.model_price ?? 0) * groupRatio)
  }

  const inputPricePerMillion = Math.max(0, model.model_ratio * 2 * groupRatio)
  const outputPricePerMillion = Math.max(
    0,
    inputPricePerMillion * model.completion_ratio
  )
  const cachePricePerMillion =
    typeof model.cache_ratio === 'number' && Number.isFinite(model.cache_ratio)
      ? inputPricePerMillion * Math.max(0, model.cache_ratio)
      : inputPricePerMillion

  const cachedTokens = Math.min(usage.cachedTokens, usage.inputTokens)
  const uncachedTokens = Math.max(0, usage.inputTokens - cachedTokens)
  const cost =
    (uncachedTokens * inputPricePerMillion +
      cachedTokens * cachePricePerMillion +
      usage.outputTokens * outputPricePerMillion) /
    1_000_000

  return Number.isFinite(cost) ? cost : (usage.reportedCostUSD ?? null)
}
