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
import type { WebSearchSource, WebSearchStatus } from '../../types'

export const WEB_SEARCH_STATUS_HEADER = 'x-webchat-web-search'
export const WEB_SEARCH_SOURCES_HEADER = 'x-webchat-web-search-sources'

const WEB_SEARCH_STATUSES = new Set<WebSearchStatus>([
  'searching',
  'used',
  'empty',
  'failed',
  'skipped',
])

export function parseWebSearchStatus(
  value: string | undefined
): WebSearchStatus | undefined {
  if (!value || !WEB_SEARCH_STATUSES.has(value as WebSearchStatus)) {
    return undefined
  }
  return value as WebSearchStatus
}

function isWebSearchSource(value: unknown): value is WebSearchSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const source = value as Record<string, unknown>
  if (
    typeof source.href !== 'string' ||
    typeof source.title !== 'string' ||
    !source.title.trim()
  ) {
    return false
  }
  try {
    const url = new URL(source.href)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function parseWebSearchSources(
  encoded: string | undefined
): WebSearchSource[] {
  if (!encoded) return []

  try {
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '='
    )
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    )
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((source) =>
      isWebSearchSource(source)
        ? [{ href: source.href, title: source.title.trim().slice(0, 200) }]
        : []
    )
  } catch {
    return []
  }
}
