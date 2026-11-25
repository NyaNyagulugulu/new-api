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
import { normalizeChatSessionRecency } from './lib/chat/chat-sessions'
import {
  parseWebSearchSources,
  parseWebSearchStatus,
  WEB_SEARCH_SOURCES_HEADER,
  WEB_SEARCH_STATUS_HEADER,
} from './lib/chat/web-search-metadata'
import { sanitizeMessagesOnLoad } from './lib/message/message-streaming-utils'
import { chatSessionsSchema } from './lib/storage/storage-schema'
import type {
  ChatImportResult,
  ChatSession,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelOption,
  GroupOption,
  MemorySettings,
  UserMemory,
  UserMemoryInput,
  UserPersona,
  WebSearchSource,
  WebSearchStatus,
} from './types'

function readResponseHeader(
  headers: unknown,
  name: string
): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const headerContainer = headers as {
    get?: (key: string) => unknown
    [key: string]: unknown
  }
  const value =
    typeof headerContainer.get === 'function'
      ? headerContainer.get(name)
      : headerContainer[name]
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined
  }
  return typeof value === 'string' ? value : undefined
}

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest,
  signal?: AbortSignal,
  onWebSearch?: (status: WebSearchStatus, sources: WebSearchSource[]) => void
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  if (onWebSearch) {
    const status = parseWebSearchStatus(
      readResponseHeader(res.headers, WEB_SEARCH_STATUS_HEADER)
    )
    if (status) {
      onWebSearch(
        status,
        parseWebSearchSources(
          readResponseHeader(res.headers, WEB_SEARCH_SOURCES_HEADER)
        )
      )
    }
  }
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
  persona_id?: number
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
        personaId:
          typeof row.persona_id === 'number' && row.persona_id >= 0
            ? row.persona_id
            : 0,
        messages: row.messages,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    ]
  })
  const parsed = chatSessionsSchema.safeParse(sessions)
  return parsed.success
    ? parsed.data.map((session) =>
        normalizeChatSessionRecency({
          ...session,
          messages: sanitizeMessagesOnLoad(session.messages),
        })
      )
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
      persona_id: session.personaId,
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

export async function importChatConversations(
  source: { file?: File; url?: string },
  signal?: AbortSignal
): Promise<ChatImportResult> {
  const form = new FormData()
  if (source.file) {
    form.append('file', source.file)
  }
  if (source.url) {
    form.append('url', source.url)
  }
  const res = await api.post(API_ENDPOINTS.CHAT_CONVERSATIONS_IMPORT, form, {
    signal,
    timeout: 10 * 60 * 1000,
  })
  const data = requireServerSuccess(res.data)
  return data.data as ChatImportResult
}

export async function getMemorySettings(): Promise<MemorySettings> {
  const res = await api.get(API_ENDPOINTS.MEMORY_SETTINGS)
  const data = requireServerSuccess(res.data)
  return data.data as MemorySettings
}

export async function searchUserMemories(
  query: string,
  group: string,
  personaId: number,
  signal?: AbortSignal
): Promise<UserMemory[]> {
  const res = await api.post(
    API_ENDPOINTS.MEMORY_SEARCH,
    {
      query,
      group,
      persona_id: personaId,
    },
    {
      signal,
    }
  )
  const data = requireServerSuccess(res.data)
  return Array.isArray(data.data) ? (data.data as UserMemory[]) : []
}

export async function saveUserMemories(
  memories: UserMemoryInput[],
  group: string
): Promise<void> {
  const res = await api.post(API_ENDPOINTS.MEMORIES, { memories, group })
  requireServerSuccess(res.data)
}

export async function getUserPersonas(): Promise<UserPersona[]> {
  const res = await api.get(API_ENDPOINTS.PERSONAS)
  const data = requireServerSuccess(res.data)
  const personas = Array.isArray(data.data) ? (data.data as UserPersona[]) : []
  return [
    {
      id: 0,
      name: '',
      traits: '',
      is_default: true,
      created_at: 0,
      updated_at: 0,
    },
    ...personas.map((persona) => ({ ...persona, is_default: false })),
  ]
}

export async function createUserPersona(input: {
  name: string
  traits: string
}): Promise<UserPersona> {
  const res = await api.post(API_ENDPOINTS.PERSONAS, input)
  const data = requireServerSuccess(res.data)
  return { ...(data.data as UserPersona), is_default: false }
}

export async function updateUserPersona(
  id: number,
  input: { name: string; traits: string }
): Promise<void> {
  const res = await api.put(`${API_ENDPOINTS.PERSONAS}/${id}`, input)
  requireServerSuccess(res.data)
}

export async function deleteUserPersona(id: number): Promise<void> {
  const res = await api.delete(`${API_ENDPOINTS.PERSONAS}/${id}`)
  requireServerSuccess(res.data)
}

export async function getUserMemoryList(): Promise<UserMemory[]> {
  const res = await api.get(`${API_ENDPOINTS.MEMORIES}/manage`)
  const data = requireServerSuccess(res.data)
  return Array.isArray(data.data) ? (data.data as UserMemory[]) : []
}

export async function deleteUserMemory(id: number): Promise<void> {
  const res = await api.delete(`${API_ENDPOINTS.MEMORIES}/${id}`)
  requireServerSuccess(res.data)
}

export async function deleteAllUserMemories(
  personaId?: number
): Promise<number> {
  const res = await api.delete(API_ENDPOINTS.MEMORIES, {
    params: personaId === undefined ? undefined : { persona_id: personaId },
  })
  const data = requireServerSuccess(res.data)
  const deleted = data.data as { deleted?: unknown } | null
  return typeof deleted?.deleted === 'number' ? deleted.deleted : 0
}
