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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { API_ENDPOINTS } from './constants'
import { extractWebSearchResults } from './lib/chat/web-search'
import { sanitizeMessagesOnLoad } from './lib/message/message-streaming-utils'
import { chatSessionsSchema } from './lib/storage/storage-schema'
import type {
  ChatSession,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelOption,
  GroupOption,
  WebSearchResult,
} from './types'

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest,
  signal?: AbortSignal
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Get user available models
 */
export async function getUserModels(group: string): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS, {
    params: { group },
  })
  const { data } = res
  requireServerSuccess(data)

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return data.data.map((model: string) => ({
    label: model,
    value: model,
  }))
}

/**
 * Get user groups
 */
export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res
  requireServerSuccess(data)

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<
    string,
    { desc: string; ratio: number | string }
  >

  // label is for button display (name only); desc is for dropdown content
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}

type ServerChatSession = {
  id: string
  title: string
  messages: unknown
  created_at: number
  updated_at: number
}

function parseChatSessions(value: unknown): ChatSession[] {
  if (!Array.isArray(value)) return []

  const sessions = value.flatMap((item) => {
    const row = item as Partial<ServerChatSession>
    if (
      typeof row.id !== 'string' ||
      typeof row.title !== 'string' ||
      typeof row.created_at !== 'number' ||
      typeof row.updated_at !== 'number'
    ) {
      return []
    }
    return [
      {
        id: row.id,
        title: row.title,
        messages: row.messages,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    ]
  })
  const parsed = chatSessionsSchema.safeParse(sessions)
  return parsed.success
    ? parsed.data.map((session) => ({
        ...session,
        messages: sanitizeMessagesOnLoad(session.messages),
      }))
    : []
}

export async function getChatConversations(): Promise<ChatSession[]> {
  const res = await api.get(API_ENDPOINTS.CHAT_CONVERSATIONS)
  const data = requireServerSuccess(res.data)
  return parseChatSessions(data?.data)
}

export async function syncChatConversations(
  sessions: ChatSession[]
): Promise<void> {
  const res = await api.put(API_ENDPOINTS.CHAT_CONVERSATIONS_SYNC, {
    sessions: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      messages: session.messages,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    })),
  })
  requireServerSuccess(res.data)
}

export async function deleteChatConversation(id: string): Promise<void> {
  const res = await api.delete(
    `${API_ENDPOINTS.CHAT_CONVERSATIONS}/${encodeURIComponent(id)}`
  )
  requireServerSuccess(res.data)
}

export async function searchWeb(
  query: string,
  signal?: AbortSignal
): Promise<WebSearchResult[]> {
  const res = await api.post(
    API_ENDPOINTS.WEB_SEARCH,
    {
      query,
      count: 5,
    },
    {
      signal,
      skipErrorHandler: true,
    } as Record<string, unknown>
  )
  return extractWebSearchResults(res.data)
}
