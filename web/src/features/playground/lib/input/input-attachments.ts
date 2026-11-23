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
import type { FileUIPart } from 'ai'
import { nanoid } from 'nanoid'

import type { MessageAttachment } from '../../types'

export const MAX_ATTACHMENT_FILES = 4
export const MAX_ATTACHMENT_FILE_BYTES = 4 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_EDGE = 2048
const IMAGE_QUALITY = 0.85

export function getDataUrlByteLength(dataUrl: string): number {
  const separatorIndex = dataUrl.indexOf(',')
  if (separatorIndex === -1) return 0

  const payload = dataUrl.slice(separatorIndex + 1)
  let padding = 0
  if (payload.endsWith('==')) {
    padding = 2
  } else if (payload.endsWith('=')) {
    padding = 1
  }
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

async function compressImageDataUrl(
  dataUrl: string,
  mediaType: string
): Promise<string> {
  if (
    typeof document === 'undefined' ||
    !mediaType.startsWith('image/') ||
    mediaType === 'image/gif' ||
    mediaType === 'image/svg+xml'
  ) {
    return dataUrl
  }

  try {
    const image = new window.Image()
    image.src = dataUrl
    await image.decode()

    const scale = Math.min(
      1,
      MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight)
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return dataUrl

    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const compressed = canvas.toDataURL('image/webp', IMAGE_QUALITY)
    return compressed.length < dataUrl.length ? compressed : dataUrl
  } catch {
    return dataUrl
  }
}

function getMediaType(dataUrl: string, fallback: string): string {
  const match = /^data:([^;,]+)/.exec(dataUrl)
  return match?.[1] ?? fallback
}

export async function createMessageAttachments(
  files: FileUIPart[]
): Promise<MessageAttachment[]> {
  const attachments: MessageAttachment[] = []

  for (const file of files) {
    if (!file.url?.startsWith('data:')) continue

    const sourceMediaType = file.mediaType || 'application/octet-stream'
    const dataUrl = await compressImageDataUrl(file.url, sourceMediaType)
    const mediaType = getMediaType(dataUrl, sourceMediaType)

    attachments.push({
      id: nanoid(),
      kind: mediaType.startsWith('image/') ? 'image' : 'file',
      name: file.filename || 'attachment',
      mediaType,
      dataUrl,
    })
  }

  return attachments
}

export function getTotalAttachmentBytes(
  attachments: MessageAttachment[]
): number {
  return attachments.reduce(
    (total, attachment) => total + getDataUrlByteLength(attachment.dataUrl),
    0
  )
}
