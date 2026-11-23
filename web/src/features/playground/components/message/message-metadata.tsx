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
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { toIntlLocale } from '@/i18n/languages'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { estimateMessageUsageCostUSD, type MessageAlignment } from '../../lib'
import type { Message } from '../../types'

type MessageMetadataProps = {
  alignment: MessageAlignment
  message: Message
}

function formatMessageTime(timestamp?: number): string | undefined {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return undefined
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

function formatDuration(
  durationMs: number | undefined,
  t: TFunction
): string | undefined {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
    return undefined
  }

  if (durationMs < 1000) {
    return t('{{value}}ms', { value: Math.max(1, Math.round(durationMs)) })
  }

  return t('{{value}}s', { value: (durationMs / 1000).toFixed(2) })
}

export function MessageMetadata(props: MessageMetadataProps) {
  const { i18n, t } = useTranslation()
  const { models, groupRatio } = usePricingData(
    Boolean(props.message.usage),
    true
  )
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const messageTime = formatMessageTime(props.message.createdAt)
  const duration = formatDuration(props.message.durationMs, t)
  const usage = props.message.usage
  const pricingModel = usage
    ? models.find((model) => model.model_name === usage.model)
    : undefined
  const estimatedCostUSD = usage
    ? estimateMessageUsageCostUSD(usage, pricingModel, groupRatio)
    : null

  if (!messageTime && !duration && !usage) {
    return null
  }

  const usageItems = usage
    ? [
        {
          label: t('Input tokens'),
          value: formatNumber(usage.inputTokens, locale),
        },
        {
          label: t('Output tokens'),
          value: formatNumber(usage.outputTokens, locale),
        },
        {
          label: t('Total tokens'),
          value: formatNumber(usage.totalTokens, locale),
        },
        ...(usage.cachedTokens > 0
          ? [
              {
                label: t('Cached tokens'),
                value: formatNumber(usage.cachedTokens, locale),
              },
            ]
          : []),
        ...(usage.cacheCreationTokens > 0
          ? [
              {
                label: t('Cache write tokens'),
                value: formatNumber(usage.cacheCreationTokens, locale),
              },
            ]
          : []),
        ...(usage.reasoningTokens > 0
          ? [
              {
                label: t('Reasoning tokens'),
                value: formatNumber(usage.reasoningTokens, locale),
              },
            ]
          : []),
        ...(usage.imageTokens > 0
          ? [
              {
                label: t('Image tokens'),
                value: formatNumber(usage.imageTokens, locale),
              },
            ]
          : []),
        ...(usage.audioTokens > 0
          ? [
              {
                label: t('Audio tokens'),
                value: formatNumber(usage.audioTokens, locale),
              },
            ]
          : []),
        {
          label: t('Estimated cost'),
          value:
            estimatedCostUSD == null
              ? t('Cost unavailable')
              : formatBillingCurrencyFromUSD(estimatedCostUSD, {
                  abbreviate: false,
                  digitsLarge: 3,
                  digitsSmall: 3,
                  locale,
                  minimumNonZero: 0.00000001,
                }),
        },
      ]
    : []

  return (
    <div
      className={cn(
        'text-muted-foreground mt-1 flex min-h-4 flex-col gap-1 text-[11px] leading-none',
        props.alignment === 'right' && 'justify-end'
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1.5',
          props.alignment === 'right' && 'justify-end'
        )}
      >
        {messageTime && <time>{messageTime}</time>}
        {duration && (
          <>
            {messageTime && <span aria-hidden='true'>·</span>}
            <span>{t('Response time: {{duration}}', { duration })}</span>
          </>
        )}
      </div>
      {usageItems.length > 0 && (
        <div
          className={cn(
            'border-border/50 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-1.5 text-xs',
            props.alignment === 'right' && 'justify-end'
          )}
        >
          {usageItems.map((item) => (
            <span className='inline-flex items-center gap-1' key={item.label}>
              <span>{item.label}:</span>
              <span className='text-foreground/75 font-mono tabular-nums'>
                {item.value}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
