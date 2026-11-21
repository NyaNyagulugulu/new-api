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
import type { ContentAuditPart } from '../api'

export type AuditConversationRole =
  | 'system'
  | 'developer'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'event'
  | 'error'

export type AuditMedia = {
  kind: 'image' | 'audio' | 'video' | 'file'
  url?: string
  base64?: string
  mimeType?: string
  name?: string
}

export type AuditToolCall = {
  id?: string
  name: string
  arguments?: string
  output?: string
}

export type AuditConversationMessage = {
  id: string
  role: AuditConversationRole
  name?: string
  text: string
  reasoning?: string
  tools: AuditToolCall[]
  media: AuditMedia[]
  raw?: string
}

export type AuditParseMode = 'conversation' | 'json' | 'text' | 'binary'

export type AuditConversationResult = {
  messages: AuditConversationMessage[]
  parseMode: AuditParseMode
  rawRequest?: string
  rawResponse?: string
}

type ConversationInput = {
  kind: string
  requestText?: string
  requestPreview?: string
  requestContentType: string
  responseText?: string
  responsePreview?: string
  responseContentType: string
  websocketText?: string
}

type ContentExtraction = {
  text: string[]
  reasoning: string[]
  tools: AuditToolCall[]
  media: AuditMedia[]
}

const REASONING_KEYS = new Set([
  'reasoning',
  'reasoning_content',
  'reasoning_text',
  'thinking',
  'thought',
])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseJson(text?: string): unknown {
  if (!text?.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function extractError(payload: unknown): string {
  const record = asRecord(payload)
  if (!record) return ''
  const error = record.error
  if (typeof error === 'string') return error
  const errorRecord = asRecord(error)
  return (
    stringValue(errorRecord?.message) ||
    stringValue(record.message) ||
    stringValue(record.detail)
  )
}

function normalizeRole(value: unknown): AuditConversationRole {
  switch (stringValue(value).toLowerCase()) {
    case 'system':
      return 'system'
    case 'developer':
      return 'developer'
    case 'assistant':
    case 'model':
      return 'assistant'
    case 'tool':
    case 'function':
      return 'tool'
    case 'error':
      return 'error'
    default:
      return 'user'
  }
}

function emptyExtraction(): ContentExtraction {
  return { text: [], reasoning: [], tools: [], media: [] }
}

function mergeExtractions(
  target: ContentExtraction,
  source: ContentExtraction
): ContentExtraction {
  target.text.push(...source.text)
  target.reasoning.push(...source.reasoning)
  target.tools.push(...source.tools)
  target.media.push(...source.media)
  return target
}

function parseDataUrl(
  value: string
): { base64: string; mimeType: string } | undefined {
  if (!value.startsWith('data:')) return undefined
  const comma = value.indexOf(',')
  if (comma < 0) return undefined
  const metadata = value.slice(5, comma)
  const base64 = value.slice(comma + 1)
  if (!base64) return undefined
  const mimeType = metadata.split(';', 1)[0] || 'application/octet-stream'
  return { base64, mimeType }
}

function mediaKindForMime(mimeType: string): AuditMedia['kind'] {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

function mediaFromValue(
  value: unknown,
  fallbackMimeType = 'application/octet-stream',
  name?: string
): AuditMedia | undefined {
  if (typeof value === 'string') {
    const dataUrl = parseDataUrl(value)
    if (dataUrl) {
      return {
        kind: mediaKindForMime(dataUrl.mimeType),
        base64: dataUrl.base64,
        mimeType: dataUrl.mimeType,
        name,
      }
    }
    if (/^https?:\/\//i.test(value)) {
      return {
        kind: mediaKindForMime(fallbackMimeType),
        url: value,
        mimeType: fallbackMimeType,
        name,
      }
    }
    return undefined
  }
  const record = asRecord(value)
  if (!record) return undefined
  const mimeType =
    stringValue(record.mime_type) ||
    stringValue(record.mimeType) ||
    stringValue(record.content_type) ||
    fallbackMimeType
  const url =
    stringValue(record.url) ||
    stringValue(record.image_url) ||
    stringValue(record.file_url) ||
    stringValue(record.inline_data)
  if (url.startsWith('data:')) {
    return mediaFromValue(url, mimeType, stringValue(record.name) || name)
  }
  if (url) {
    return {
      kind: mediaKindForMime(mimeType),
      url,
      mimeType,
      name: stringValue(record.name) || name,
    }
  }
  const base64 =
    stringValue(record.base64) ||
    stringValue(record.data) ||
    stringValue(record.b64_json)
  if (base64) {
    return {
      kind: mediaKindForMime(mimeType),
      base64,
      mimeType,
      name: stringValue(record.name) || name,
    }
  }
  return undefined
}

function audioMimeType(format?: string): string {
  switch (format?.toLowerCase()) {
    case 'wav':
      return 'audio/wav'
    case 'opus':
      return 'audio/opus'
    case 'aac':
      return 'audio/aac'
    case 'flac':
      return 'audio/flac'
    case 'pcm':
      return 'audio/pcm'
    case 'mp3':
    case 'mpeg':
      return 'audio/mpeg'
    default:
      return 'audio/mpeg'
  }
}

function toolFromPart(
  part: Record<string, unknown>
): AuditToolCall | undefined {
  const functionRecord = asRecord(part.function)
  const name =
    stringValue(part.name) ||
    stringValue(functionRecord?.name) ||
    stringValue(part.tool_name)
  if (!name) return undefined
  const args =
    stringValue(part.arguments) ||
    stringValue(functionRecord?.arguments) ||
    stringValue(part.input)
  return {
    id: stringValue(part.id) || stringValue(part.call_id) || undefined,
    name,
    arguments: args,
  }
}

function parseContentPart(part: unknown): ContentExtraction {
  const extraction = emptyExtraction()
  if (typeof part === 'string') {
    extraction.text.push(part)
    return extraction
  }
  const record = asRecord(part)
  if (!record) return extraction
  const type = stringValue(record.type).toLowerCase()
  if (
    type === 'text' ||
    type === 'input_text' ||
    type === 'output_text' ||
    type === 'summary_text' ||
    type === 'reasoning_text'
  ) {
    const text = stringValue(record.text)
    if (text) {
      if (type.includes('reasoning')) extraction.reasoning.push(text)
      else extraction.text.push(text)
    }
    return extraction
  }
  if (REASONING_KEYS.has(type)) {
    const text =
      stringValue(record.text) ||
      stringValue(record.content) ||
      stringValue(record.thinking)
    if (text) extraction.reasoning.push(text)
    return extraction
  }
  if (type === 'tool_use' || type === 'function_call' || type === 'tool_call') {
    const tool = toolFromPart(record)
    if (tool) extraction.tools.push(tool)
    return extraction
  }
  if (
    type === 'tool_result' ||
    type === 'function_call_output' ||
    type === 'function_response' ||
    type === 'tool_response'
  ) {
    const output =
      stringValue(record.output) ||
      stringValue(record.content) ||
      stringValue(record.result)
    const name =
      stringValue(record.name) || stringValue(record.tool_name) || 'tool'
    extraction.tools.push({
      id: stringValue(record.call_id) || stringValue(record.tool_use_id),
      name,
      output,
    })
    return extraction
  }
  if (type === 'image_url' || type === 'input_image') {
    const value = record.image_url ?? record.url ?? record.image
    const media = mediaFromValue(value, 'image/png')
    if (media) extraction.media.push(media)
    return extraction
  }
  if (type === 'input_audio' || type === 'audio') {
    const audio = asRecord(record.audio) ?? record
    const media = mediaFromValue(
      stringValue(audio.data) || audio.url || audio,
      audioMimeType(stringValue(audio.format)),
      'audio'
    )
    if (media) extraction.media.push(media)
    return extraction
  }
  if (type === 'inline_data' || type === 'inlinedata') {
    const inlineData =
      asRecord(record.inlineData) ?? asRecord(record.inline_data) ?? record
    const mimeType =
      stringValue(inlineData.mimeType) || stringValue(inlineData.mime_type)
    const media = mediaFromValue(
      inlineData.data,
      mimeType || 'application/octet-stream'
    )
    if (media) extraction.media.push(media)
    return extraction
  }
  if (type === 'file' || type === 'input_file' || type === 'file_data') {
    const file = asRecord(record.file) ?? record
    const mimeType =
      stringValue(file.mime_type) ||
      stringValue(file.mimeType) ||
      'application/octet-stream'
    const media = mediaFromValue(
      file.file_data ?? file.file_url ?? file.data,
      mimeType,
      stringValue(file.filename) || stringValue(file.name)
    )
    if (media) extraction.media.push(media)
    return extraction
  }
  const nested = record.content
  if (nested !== undefined) {
    return parseContentParts(nested)
  }
  return extraction
}

function parseContentParts(value: unknown): ContentExtraction {
  if (Array.isArray(value)) {
    const extraction = emptyExtraction()
    for (const part of value) {
      mergeExtractions(extraction, parseContentPart(part))
    }
    return extraction
  }
  return parseContentPart(value)
}

function parseToolCalls(value: unknown): AuditToolCall[] {
  const tools: AuditToolCall[] = []
  for (const item of asArray(value)) {
    const record = asRecord(item)
    if (!record) continue
    const tool = toolFromPart(record)
    if (tool) tools.push(tool)
  }
  return tools
}

function messageFromRecord(
  value: unknown,
  fallbackRole: AuditConversationRole,
  index: number
): AuditConversationMessage | undefined {
  if (typeof value === 'string') {
    return {
      id: `message-${index}`,
      role: fallbackRole,
      text: value,
      tools: [],
      media: [],
    }
  }
  const record = asRecord(value)
  if (!record) return undefined
  const itemType = stringValue(record.type).toLowerCase()
  let role = normalizeRole(record.role ?? fallbackRole)
  if (
    itemType === 'reasoning' ||
    itemType === 'function_call' ||
    itemType === 'tool_use'
  ) {
    role = 'assistant'
  } else if (
    itemType === 'function_call_output' ||
    itemType === 'tool_result' ||
    itemType === 'function_response'
  ) {
    role = 'tool'
  }
  const contentSource =
    itemType === 'reasoning'
      ? (record.summary ??
        record.content ??
        record.parts ??
        record.text ??
        record.thinking)
      : (record.content ?? record.parts ?? record.text)
  const content = parseContentParts(contentSource)
  let reasoningFromContent = content.reasoning.join('\n\n')
  if (itemType === 'reasoning' && content.text.length > 0) {
    reasoningFromContent = [reasoningFromContent, ...content.text]
      .filter(Boolean)
      .join('\n\n')
    content.text.length = 0
  }
  const reasoning =
    reasoningFromContent ||
    stringValue(record.reasoning_content) ||
    stringValue(record.reasoning) ||
    stringValue(record.thinking)
  const tools = [
    ...content.tools,
    ...parseToolCalls(record.tool_calls ?? record.toolCalls),
  ]
  if (
    itemType === 'function_call' ||
    itemType === 'tool_use' ||
    itemType === 'tool_call'
  ) {
    const tool = toolFromPart(record)
    if (tool) tools.push(tool)
  } else if (
    itemType === 'function_call_output' ||
    itemType === 'tool_result' ||
    itemType === 'function_response'
  ) {
    tools.push({
      id: stringValue(record.call_id) || stringValue(record.tool_use_id),
      name: stringValue(record.name) || stringValue(record.tool_name) || 'tool',
      output:
        stringValue(record.output) ||
        stringValue(record.content) ||
        stringValue(record.result),
    })
  }
  const audio = asRecord(record.audio)
  if (audio) {
    const media = mediaFromValue(
      stringValue(audio.data) || audio,
      audioMimeType(stringValue(audio.format)),
      'audio'
    )
    if (media) content.media.push(media)
  }
  const hasMessage =
    content.text.length > 0 ||
    reasoning ||
    tools.length > 0 ||
    content.media.length > 0
  if (!hasMessage) return undefined
  return {
    id:
      stringValue(record.id) ||
      stringValue(record.call_id) ||
      `message-${index}`,
    role,
    name: stringValue(record.name) || undefined,
    text: content.text.join('\n\n'),
    reasoning: reasoning || undefined,
    tools,
    media: content.media,
  }
}

function parseMessages(value: unknown, fallbackRole: AuditConversationRole) {
  const messages: AuditConversationMessage[] = []
  asArray(value).forEach((item, index) => {
    const message = messageFromRecord(item, fallbackRole, index)
    if (message) messages.push(message)
  })
  return messages
}

function parseRequestPayload(payload: unknown, kind: string, raw: string) {
  const record = asRecord(payload)
  if (!record) {
    return raw.trim()
      ? [
          {
            id: 'request-text',
            role: 'user' as const,
            text: raw,
            tools: [],
            media: [],
          },
        ]
      : []
  }
  if (Array.isArray(record.messages)) {
    return parseMessages(record.messages, 'user')
  }
  const messages: AuditConversationMessage[] = []
  const instructions =
    record.instructions ?? record.system ?? record.systemInstruction
  const instructionRecord = asRecord(instructions)
  if (typeof instructions === 'string' && instructions.trim()) {
    messages.push({
      id: 'instructions',
      role: 'developer',
      text: instructions,
      tools: [],
      media: [],
    })
  } else if (instructionRecord) {
    const content = parseContentParts(
      instructionRecord.content ?? instructionRecord.parts ?? instructionRecord
    )
    if (content.text.length || content.reasoning.length) {
      messages.push({
        id: 'instructions',
        role: 'developer',
        text: content.text.join('\n\n'),
        reasoning: content.reasoning.join('\n\n') || undefined,
        tools: content.tools,
        media: content.media,
      })
    }
  }
  if (typeof record.input === 'string') {
    messages.push({
      id: 'input',
      role: 'user',
      text: record.input,
      tools: [],
      media: [],
    })
    return messages
  }
  if (Array.isArray(record.input)) {
    messages.push(...parseMessages(record.input, 'user'))
    return messages
  }
  if (Array.isArray(record.contents)) {
    for (const [index, item] of record.contents.entries()) {
      const message = messageFromRecord(item, 'user', index)
      if (message) messages.push(message)
    }
    return messages
  }
  if (kind === 'image') {
    const prompt = stringValue(record.prompt)
    const mediaFromRequest = parseContentParts(
      record.image ?? record.images ?? record.mask ?? []
    ).media
    if (prompt || mediaFromRequest.length) {
      messages.push({
        id: 'image-request',
        role: 'user',
        text: prompt || 'Image edit request',
        tools: [],
        media: mediaFromRequest,
      })
    }
    return messages
  }
  if (kind === 'tts') {
    const input = stringValue(record.input) || stringValue(record.text)
    if (input) {
      messages.push({
        id: 'tts-request',
        role: 'user',
        text: input,
        tools: [],
        media: [],
      })
    }
    return messages
  }
  const fallback = messageFromRecord(record, 'user', 0)
  return fallback ? [fallback] : []
}

function parseMultipartPreview(preview: string): AuditConversationMessage[] {
  if (!preview.trim()) return []
  const text: string[] = []
  for (const block of preview.split(/\n\n+/)) {
    const lines = block.split('\n')
    const fieldMatch = /^Field:\s*(.+)$/.exec(lines[0] ?? '')
    if (fieldMatch) {
      const value = lines.slice(1).join('\n').trim()
      if (value) text.push(value)
      continue
    }
    const fileMatch = /^File:\s*(.+)$/.exec(lines[0] ?? '')
    if (fileMatch) {
      const filename = lines
        .find((line) => line.startsWith('Filename: '))
        ?.slice(10)
      const mimeType = lines
        .find((line) => line.startsWith('Content-Type: '))
        ?.slice(14)
      const size = lines.find((line) => line.startsWith('Size: '))?.slice(6)
      text.push(
        `Attached file: ${filename || fileMatch[1] || 'file'}${
          mimeType ? ` (${mimeType}${size ? `, ${size} B` : ''})` : ''
        }`
      )
      continue
    }
    if (block.trim()) text.push(block.trim())
  }
  return text.length
    ? [
        {
          id: 'multipart-request',
          role: 'user',
          text: text.join('\n\n'),
          tools: [],
          media: [],
        },
      ]
    : []
}

function responseMessage(
  extraction: ContentExtraction,
  id = 'assistant-response'
): AuditConversationMessage | undefined {
  if (
    extraction.text.length === 0 &&
    extraction.reasoning.length === 0 &&
    extraction.tools.length === 0 &&
    extraction.media.length === 0
  ) {
    return undefined
  }
  return {
    id,
    role: 'assistant',
    text: extraction.text.join('\n\n'),
    reasoning: extraction.reasoning.join('\n\n') || undefined,
    tools: extraction.tools,
    media: extraction.media,
  }
}

function parseResponsePayload(payload: unknown, kind: string) {
  const record = asRecord(payload)
  if (!record) {
    if (typeof payload === 'string') {
      return responseMessage({ ...emptyExtraction(), text: [payload] })
    }
    return undefined
  }
  const error = extractError(record)
  if (error) {
    return {
      id: 'assistant-error',
      role: 'error' as const,
      text: error,
      tools: [],
      media: [],
    }
  }
  const extraction = emptyExtraction()
  const choices = asArray(record.choices)
  if (choices.length) {
    const choice = asRecord(choices[0])
    const message = choice?.message ?? choice?.delta
    const parsed = messageFromRecord(message, 'assistant', 0)
    if (parsed) return { ...parsed, id: 'assistant-response' }
  }
  if (Array.isArray(record.output)) {
    for (const [index, item] of record.output.entries()) {
      const message = messageFromRecord(item, 'assistant', index)
      if (message) {
        mergeExtractions(extraction, {
          text: message.text ? [message.text] : [],
          reasoning: message.reasoning ? [message.reasoning] : [],
          tools: message.tools,
          media: message.media,
        })
      }
    }
    const response = responseMessage(extraction)
    if (response) return response
  }
  if (Array.isArray(record.content)) {
    const parsed = parseContentParts(record.content)
    return responseMessage(parsed)
  }
  if (Array.isArray(record.candidates)) {
    const candidate = asRecord(record.candidates[0])
    const content = asRecord(candidate?.content)
    const parsed = parseContentParts(content?.parts)
    return responseMessage(parsed)
  }
  if (kind === 'image' || Array.isArray(record.data)) {
    const images: AuditMedia[] = []
    for (const item of asArray(record.data)) {
      const imageRecord = asRecord(item)
      if (!imageRecord) continue
      const image = mediaFromValue(
        imageRecord.url ?? imageRecord.b64_json ?? imageRecord,
        'image/png',
        'generated-image'
      )
      if (image) images.push(image)
    }
    if (images.length) {
      return {
        id: 'assistant-image',
        role: 'assistant' as const,
        text: '',
        tools: [],
        media: images,
      }
    }
  }
  const transcript = stringValue(record.text) || stringValue(record.transcript)
  if (transcript) {
    return responseMessage({ ...emptyExtraction(), text: [transcript] })
  }
  if (Array.isArray(record.results)) {
    return {
      id: 'assistant-results',
      role: 'assistant' as const,
      text: '',
      tools: [],
      media: [],
      raw: JSON.stringify(record, null, 2),
    }
  }
  if (Object.keys(record).length > 0) {
    return {
      id: 'assistant-json',
      role: 'assistant' as const,
      text: '',
      tools: [],
      media: [],
      raw: JSON.stringify(record, null, 2),
    }
  }
  return undefined
}

type StreamAccumulator = {
  text: string[]
  reasoning: string[]
  tools: Map<string, AuditToolCall>
  media: AuditMedia[]
}

function newStreamAccumulator(): StreamAccumulator {
  return { text: [], reasoning: [], tools: new Map(), media: [] }
}

function appendToolDelta(
  accumulator: StreamAccumulator,
  item: unknown,
  index: number
) {
  const record = asRecord(item)
  if (!record) return
  const fn = asRecord(record.function)
  const key =
    stringValue(record.id) ||
    stringValue(record.call_id) ||
    stringValue(record.index) ||
    String(index)
  const current = accumulator.tools.get(key) ?? {
    id: stringValue(record.id) || stringValue(record.call_id) || undefined,
    name: '',
    arguments: '',
  }
  current.name += stringValue(fn?.name) || stringValue(record.name)
  current.arguments = `${current.arguments ?? ''}${
    stringValue(fn?.arguments) || stringValue(record.arguments)
  }`
  accumulator.tools.set(key, current)
}

function consumeStreamEvent(accumulator: StreamAccumulator, payload: unknown) {
  const record = asRecord(payload)
  if (!record) return
  const error = extractError(record)
  if (error) {
    accumulator.text.push(error)
    return
  }
  const choices = asArray(record.choices)
  if (choices.length) {
    const choice = asRecord(choices[0])
    const delta = asRecord(choice?.delta) ?? asRecord(choice?.message)
    if (delta) {
      const content = parseContentParts(delta.content)
      accumulator.text.push(...content.text)
      accumulator.reasoning.push(...content.reasoning)
      accumulator.media.push(...content.media)
      const reasoning =
        stringValue(delta.reasoning_content) || stringValue(delta.reasoning)
      if (reasoning) accumulator.reasoning.push(reasoning)
      asArray(delta.tool_calls).forEach((item, index) =>
        appendToolDelta(accumulator, item, index)
      )
    }
    return
  }
  const type = stringValue(record.type)
  if (type === 'response.output_text.delta') {
    accumulator.text.push(stringValue(record.delta))
  } else if (
    type === 'response.reasoning_text.delta' ||
    type === 'response.reasoning_summary_text.delta'
  ) {
    accumulator.reasoning.push(stringValue(record.delta))
  } else if (
    type === 'response.output_item.added' ||
    type === 'response.output_item.done'
  ) {
    const item = asRecord(record.item)
    if (item?.type === 'function_call') {
      appendToolDelta(accumulator, item, accumulator.tools.size)
    } else if (item?.type === 'message') {
      const parsed = messageFromRecord(
        item,
        'assistant',
        accumulator.tools.size
      )
      if (parsed && type === 'response.output_item.done') {
        accumulator.text.length = 0
        accumulator.text.push(parsed.text)
        if (parsed.reasoning) {
          accumulator.reasoning.length = 0
          accumulator.reasoning.push(parsed.reasoning)
        }
      }
    } else {
      const parsed = messageFromRecord(
        item,
        'assistant',
        accumulator.tools.size
      )
      if (parsed) {
        accumulator.text.push(parsed.text)
        accumulator.media.push(...parsed.media)
      }
    }
  } else if (type === 'response.function_call_arguments.delta') {
    const key = stringValue(record.item_id) || stringValue(record.call_id)
    const current = accumulator.tools.get(key) ?? {
      id: key || undefined,
      name: stringValue(record.name) || 'tool',
      arguments: '',
    }
    current.arguments = `${current.arguments ?? ''}${stringValue(record.delta)}`
    accumulator.tools.set(key, current)
  } else if (type === 'response.audio.delta') {
    const media = mediaFromValue(
      stringValue(record.delta),
      audioMimeType(stringValue(record.format)),
      'audio'
    )
    if (media) accumulator.media.push(media)
  } else if (type === 'content_block_delta') {
    const delta = asRecord(record.delta)
    const text =
      stringValue(delta?.text) ||
      stringValue(delta?.thinking) ||
      stringValue(delta?.partial_json)
    if (stringValue(delta?.type) === 'thinking_delta') {
      accumulator.reasoning.push(text)
    } else if (stringValue(delta?.type) === 'input_json_delta') {
      const index = numberValue(record.index) ?? 0
      const current = accumulator.tools.get(String(index)) ?? {
        name: 'tool',
        arguments: '',
      }
      current.arguments = `${current.arguments ?? ''}${text}`
      accumulator.tools.set(String(index), current)
    } else {
      accumulator.text.push(text)
    }
  } else if (type === 'content_block_start') {
    const block = asRecord(record.content_block)
    if (block?.type === 'tool_use') {
      const index = numberValue(record.index) ?? 0
      accumulator.tools.set(String(index), {
        id: stringValue(block.id),
        name: stringValue(block.name) || 'tool',
        arguments: '',
      })
    }
  } else if (type === 'response.completed') {
    const response = asRecord(record.response)
    const parsed = parseResponsePayload(response, 'responses')
    if (parsed?.text) {
      accumulator.text.length = 0
      accumulator.text.push(parsed.text)
    }
    if (parsed?.reasoning) {
      accumulator.reasoning.length = 0
      accumulator.reasoning.push(parsed.reasoning)
    }
    if (parsed?.media.length) accumulator.media.push(...parsed.media)
  } else if (type === 'response.image_generation_call.partial_image') {
    const media = mediaFromValue(
      stringValue(record.partial_image_b64),
      'image/png',
      'generated-image'
    )
    if (media) accumulator.media.push(media)
  }
}

function parseSseConversation(
  text: string
): AuditConversationMessage | undefined {
  const accumulator = newStreamAccumulator()
  let bufferedData: string[] = []
  const flush = () => {
    if (bufferedData.length === 0) return
    const data = bufferedData.join('\n')
    bufferedData = []
    if (data === '[DONE]') return
    consumeStreamEvent(accumulator, parseJson(data) ?? data)
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      flush()
      continue
    }
    if (line.startsWith('data:')) {
      bufferedData.push(line.slice(5).trimStart())
    }
  }
  flush()
  const extraction: ContentExtraction = {
    text: accumulator.text.filter(Boolean),
    reasoning: accumulator.reasoning.filter(Boolean),
    tools: [...accumulator.tools.values()],
    media: accumulator.media,
  }
  return responseMessage(extraction)
}

function parseWebSocketJournal(text: string): AuditConversationMessage[] {
  const messages: AuditConversationMessage[] = []
  const assistantText: string[] = []
  const userText: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const frame = asRecord(parseJson(line))
    if (!frame) continue
    const direction = stringValue(frame.direction)
    const payloadText = stringValue(frame.text)
    const payload = parseJson(payloadText) ?? payloadText
    const record = asRecord(payload)
    if (!record) {
      if (payloadText) {
        if (direction === 'client') userText.push(payloadText)
        else assistantText.push(payloadText)
      }
      continue
    }
    const type = stringValue(record.type)
    if (type === 'conversation.item.input_audio_transcription.completed') {
      userText.push(stringValue(record.transcript))
    } else if (
      type === 'response.audio_transcript.delta' ||
      type === 'response.text.delta' ||
      type === 'response.output_text.delta'
    ) {
      assistantText.push(stringValue(record.delta))
    } else if (type === 'response.done') {
      const response = asRecord(record.response)
      const parsed = parseResponsePayload(response, 'realtime')
      if (parsed?.text) assistantText.push(parsed.text)
    } else if (type === 'conversation.item.created') {
      const item = asRecord(record.item)
      const parsed = messageFromRecord(item, 'user', messages.length)
      if (parsed) messages.push(parsed)
    }
  }
  if (userText.filter(Boolean).length) {
    messages.unshift({
      id: 'realtime-user',
      role: 'user',
      text: userText.filter(Boolean).join('\n\n'),
      tools: [],
      media: [],
    })
  }
  if (assistantText.filter(Boolean).length) {
    messages.push({
      id: 'realtime-assistant',
      role: 'assistant',
      text: assistantText.filter(Boolean).join(''),
      tools: [],
      media: [],
    })
  }
  return messages
}

function isSse(contentType: string, text: string): boolean {
  return (
    contentType.toLowerCase().includes('text/event-stream') ||
    /^(event|data):/m.test(text)
  )
}

function parseResponseText(text: string, contentType: string, kind: string) {
  if (!text.trim()) return undefined
  if (isSse(contentType, text)) return parseSseConversation(text)
  const payload = parseJson(text)
  if (payload !== undefined) return parseResponsePayload(payload, kind)
  return responseMessage({ ...emptyExtraction(), text: [text] })
}

export function buildContentAuditConversation(
  input: ConversationInput
): AuditConversationResult {
  if (input.websocketText?.trim()) {
    const messages = parseWebSocketJournal(input.websocketText)
    return {
      messages,
      parseMode: messages.length ? 'conversation' : 'text',
      rawRequest: input.requestText,
      rawResponse: input.websocketText,
    }
  }
  const requestText = input.requestText?.trim() ? input.requestText : ''
  const responseText = input.responseText?.trim() ? input.responseText : ''
  let requestMessages: AuditConversationMessage[] = []
  const requestPayload = parseJson(requestText)
  if (requestPayload !== undefined) {
    requestMessages = parseRequestPayload(
      requestPayload,
      input.kind,
      requestText
    )
  } else if (requestText) {
    requestMessages = parseRequestPayload(undefined, input.kind, requestText)
  } else if (input.requestPreview?.includes('Field:')) {
    requestMessages = parseMultipartPreview(input.requestPreview)
  }

  let responseTextValue = responseText
  if (!responseTextValue && input.responsePreview) {
    responseTextValue = input.responsePreview
  }
  const responseMessageValue = parseResponseText(
    responseTextValue,
    input.responseContentType,
    input.kind
  )
  const messages = [...requestMessages]
  if (responseMessageValue) {
    messages.push(responseMessageValue)
  }
  if (messages.length > 0) {
    return {
      messages,
      parseMode:
        requestMessages.length > 0 || responseMessageValue
          ? 'conversation'
          : 'text',
      rawRequest: requestText || input.requestPreview,
      rawResponse: responseText || input.responsePreview,
    }
  }
  if (
    input.responseContentType.startsWith('image/') ||
    input.responseContentType.startsWith('audio/') ||
    input.responseContentType.startsWith('video/')
  ) {
    return {
      messages: [],
      parseMode: 'binary',
      rawRequest: requestText,
      rawResponse: responseText,
    }
  }
  return {
    messages: [],
    parseMode: requestText || responseText ? 'text' : 'binary',
    rawRequest: requestText || input.requestPreview,
    rawResponse: responseText || input.responsePreview,
  }
}

export function contentAuditPartLabel(part: ContentAuditPart): string {
  switch (part) {
    case 'request':
      return 'Request'
    case 'response':
      return 'Response'
    case 'websocket':
      return 'WebSocket'
  }
}
