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
import { MESSAGE_ROLES } from '../../constants'
import type {
  ChatCompletionMessage,
  ChatCompletionRequest,
  Message,
  WebSearchResult,
} from '../../types'
import { getMessageContent } from '../message/message-utils'

const MAX_QUERY_LENGTH = 2_000
const MAX_RESULTS = 8
const MAX_SNIPPET_LENGTH = 800

function getResultString(
  result: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const value = result[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function normalizeResult(result: unknown): WebSearchResult | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null
  }

  const record = result as Record<string, unknown>
  const title = getResultString(record, ['title', 'name'])
  const url = getResultString(record, ['url', 'link'])
  const snippet = getResultString(record, [
    'snippet',
    'content',
    'description',
    'summary',
  ])

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return null
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return null
  }

  return {
    title: title || parsedUrl.hostname,
    url: parsedUrl.toString(),
    ...(snippet ? { snippet: snippet.slice(0, MAX_SNIPPET_LENGTH) } : {}),
  }
}

function getResultArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []

  const record = value as Record<string, unknown>
  for (const key of ['results', 'data', 'web_search']) {
    if (Array.isArray(record[key])) {
      return record[key]
    }
  }
  return []
}

export function extractWebSearchResults(value: unknown): WebSearchResult[] {
  const results: WebSearchResult[] = []
  const seenUrls = new Set<string>()

  for (const item of getResultArray(value)) {
    const result = normalizeResult(item)
    if (!result || seenUrls.has(result.url)) continue
    seenUrls.add(result.url)
    results.push(result)
    if (results.length >= MAX_RESULTS) break
  }

  return results
}

export function getWebSearchQuery(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].from !== MESSAGE_ROLES.USER) continue
    return getMessageContent(messages[index]).trim().slice(0, MAX_QUERY_LENGTH)
  }
  return ''
}

function buildWebSearchContext(results: WebSearchResult[]): string {
  const entries = results.map((result, index) => {
    const snippet = result.snippet ? `\n${result.snippet}` : ''
    return `[${index + 1}] ${result.title}\n${result.url}${snippet}`
  })

  return [
    'Web search results are provided below. Use them when relevant.',
    'Do not claim a fact came from these results unless it is supported by them.',
    'When useful, cite sources using their Markdown links.',
    '',
    ...entries,
  ].join('\n')
}

function addContextToMessage(
  message: ChatCompletionMessage,
  context: string
): ChatCompletionMessage {
  if (typeof message.content === 'string') {
    return {
      ...message,
      content: `${message.content}\n\n---\n${context}`,
    }
  }

  return {
    ...message,
    content: [
      ...message.content,
      {
        type: 'text',
        text: context,
      },
    ],
  }
}

export function addWebSearchContext(
  payload: ChatCompletionRequest,
  results: WebSearchResult[]
): ChatCompletionRequest {
  if (results.length === 0) return payload

  const context = buildWebSearchContext(results)
  let targetIndex = -1
  for (let index = payload.messages.length - 1; index >= 0; index--) {
    if (payload.messages[index].role === MESSAGE_ROLES.USER) {
      targetIndex = index
      break
    }
  }
  if (targetIndex === -1) return payload

  return {
    ...payload,
    messages: payload.messages.map((message, index) =>
      index === targetIndex ? addContextToMessage(message, context) : message
    ),
  }
}
