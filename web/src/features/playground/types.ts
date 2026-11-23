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
// Message types
export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageStatus = 'loading' | 'streaming' | 'complete' | 'error'

export type PlaygroundMessageLayoutMode = 'alternating' | 'left'

export type ReasoningEffort =
  | ''
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export interface MessageAttachment {
  id: string
  kind: 'image' | 'file'
  name: string
  mediaType: string
  dataUrl: string
}

export interface MessageVersion {
  id: string
  content: string
  attachments?: MessageAttachment[]
}

export interface MessageUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  imageTokens: number
  audioTokens: number
  model?: string
  group?: string
  reasoningEffort?: ReasoningEffort
  reportedCostUSD?: number
}

export interface Message {
  key: string
  from: MessageRole
  versions: MessageVersion[]
  isContextSummary?: boolean
  model?: string
  createdAt?: number
  startedAt?: number
  completedAt?: number
  durationMs?: number
  sources?: { href: string; title: string }[]
  reasoning?: {
    content: string
    duration: number
    startedAt?: number
    completedAt?: number
    durationMs?: number
  }
  isReasoningStreaming?: boolean
  isReasoningComplete?: boolean
  isContentComplete?: boolean
  status?: MessageStatus
  errorCode?: string | null
  usage?: MessageUsage
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

// API payload types
export interface ChatCompletionMessage {
  role: MessageRole
  content: string | ContentPart[]
}

export interface ContentPart {
  type: 'text' | 'image_url' | 'file'
  text?: string
  image_url?: {
    url: string
  }
  file?: {
    filename?: string
    file_data?: string
    file_id?: string
  }
}

export interface ChatCompletionRequest {
  model: string
  group?: string
  messages: ChatCompletionMessage[]
  stream: boolean
  reasoning_effort?: Exclude<ReasoningEffort, ''>
  stream_options?: {
    include_usage: boolean
  }
  temperature?: number
  top_p?: number
  max_tokens?: number
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
}

export interface WebSearchResult {
  title: string
  url: string
  snippet?: string
}

export interface MemorySettings {
  enabled: boolean
  auto_extract: boolean
  extract_every_rounds: number
  extract_window_messages: number
  retrieve_limit: number
  max_injected_chars: number
  min_importance: number
  retention_days: number
}

export interface UserMemory {
  id: number
  content: string
  keywords: string
  category: string
  importance: number
  conversation_id: string
  source_key: string
  status: string
  created_at: number
  updated_at: number
}

export interface UserMemoryInput {
  content: string
  keywords: string[]
  category: string
  importance: number
  conversation_id: string
  source_key: string
}

export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  usage?: ChatCompletionUsage | null
  choices: Array<{
    index: number
    delta: {
      role?: MessageRole
      content?: string
      reasoning_content?: string | null
      reasoning?: string | null
    }
    finish_reason: string | null
  }>
}

export interface ChatCompletionUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  input_tokens?: number
  output_tokens?: number
  prompt_tokens_details?: {
    cached_tokens?: number
    cache_write_tokens?: number
    cached_creation_tokens?: number
    cache_creation_input_tokens?: number
    text_tokens?: number
    image_tokens?: number
    audio_tokens?: number
  }
  completion_tokens_details?: {
    reasoning_tokens?: number
    text_tokens?: number
    image_tokens?: number
    audio_tokens?: number
  }
  input_tokens_details?: ChatCompletionUsage['prompt_tokens_details']
  output_tokens_details?: ChatCompletionUsage['completion_tokens_details']
  cost?: number | string
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: MessageRole
      content: string
      reasoning_content?: string | null
      reasoning?: string | null
    }
    finish_reason: string
  }>
  usage?: ChatCompletionUsage
}

// Configuration types
export interface PlaygroundConfig {
  model: string
  group: string
  temperature: number
  top_p: number
  max_tokens: number
  frequency_penalty: number
  presence_penalty: number
  seed: number | null
  stream: boolean
  reasoningEffort: ReasoningEffort
  webSearch: boolean
}

export interface ParameterEnabled {
  temperature: boolean
  top_p: boolean
  max_tokens: boolean
  frequency_penalty: boolean
  presence_penalty: boolean
  seed: boolean
}

// Model and group options
export interface ModelOption {
  label: string
  value: string
}

export interface GroupOption {
  label: string
  value: string
  ratio: number | string
  desc?: string
}
