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
export const CONTENT_AUDIT_KINDS = [
  'chat',
  'responses',
  'image',
  'video',
  'tts',
  'asr',
  'realtime',
  'tools',
  'rerank',
  'other',
] as const

export type ContentAuditKind = (typeof CONTENT_AUDIT_KINDS)[number]

const KIND_LABELS: Record<ContentAuditKind, string> = {
  chat: 'Chat',
  responses: 'Responses',
  image: 'Images',
  video: 'Video',
  tts: 'Text to speech',
  asr: 'Speech recognition',
  realtime: 'Realtime',
  tools: 'Tools',
  rerank: 'Rerank',
  other: 'Other',
}

const KIND_VARIANTS: Record<
  ContentAuditKind,
  'neutral' | 'info' | 'purple' | 'warning' | 'success'
> = {
  chat: 'info',
  responses: 'purple',
  image: 'warning',
  video: 'warning',
  tts: 'success',
  asr: 'success',
  realtime: 'info',
  tools: 'neutral',
  rerank: 'neutral',
  other: 'neutral',
}

export function normalizeContentAuditKind(kind: string): ContentAuditKind {
  return CONTENT_AUDIT_KINDS.includes(kind as ContentAuditKind)
    ? (kind as ContentAuditKind)
    : 'other'
}

export function contentAuditKindLabel(kind: string): string {
  return KIND_LABELS[normalizeContentAuditKind(kind)]
}

export function contentAuditKindVariant(
  kind: string
): (typeof KIND_VARIANTS)[ContentAuditKind] {
  return KIND_VARIANTS[normalizeContentAuditKind(kind)]
}

export function formatContentAuditSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  const value = bytes / 1024 ** unitIndex
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function normalizeContentType(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

export function isPreviewableTextContentType(contentType: string): boolean {
  const mediaType = normalizeContentType(contentType)
  return (
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType === 'application/x-ndjson' ||
    mediaType === 'application/xml' ||
    mediaType.endsWith('+json') ||
    mediaType.endsWith('+xml')
  )
}

export function isPreviewableImageContentType(contentType: string): boolean {
  return [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/bmp',
  ].includes(normalizeContentType(contentType))
}

export function isPreviewableAudioContentType(contentType: string): boolean {
  return [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/opus',
    'audio/flac',
    'audio/aac',
    'audio/mp4',
  ].includes(normalizeContentType(contentType))
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  URL.revokeObjectURL(url)
}
