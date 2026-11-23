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
import { expect, test } from 'vitest'

import type { Message } from '../../../types'
import {
  formatMessageForAPI,
  createUserMessage,
} from '../../message/message-utils'
import {
  createMessageAttachments,
  getDataUrlByteLength,
  getTotalAttachmentBytes,
} from '../input-attachments'
import {
  getInputControlState,
  getSubmittableInputContent,
} from '../input-control-utils'

const imageDataUrl = 'data:image/png;base64,aGVsbG8='
const fileDataUrl = 'data:application/pdf;base64,aGVsbG8='

test('images and files are preserved as Chat Completions content parts', async () => {
  const attachments = await createMessageAttachments([
    {
      type: 'file',
      url: imageDataUrl,
      mediaType: 'image/png',
      filename: 'diagram.png',
    },
    {
      type: 'file',
      url: fileDataUrl,
      mediaType: 'application/pdf',
      filename: 'spec.pdf',
    },
  ])
  const message: Message = createUserMessage(
    'Review these files',
    Date.now(),
    attachments
  )

  expect(formatMessageForAPI(message)).toEqual({
    role: 'user',
    content: [
      { type: 'text', text: 'Review these files' },
      { type: 'image_url', image_url: { url: imageDataUrl } },
      {
        type: 'file',
        file: {
          filename: 'spec.pdf',
          file_data: fileDataUrl,
        },
      },
    ],
  })
})

test('attachment-only messages can be submitted and sent', () => {
  const file = {
    type: 'file' as const,
    url: imageDataUrl,
    mediaType: 'image/png',
    filename: 'diagram.png',
  }

  expect(getSubmittableInputContent({ text: '  ', files: [file] })).toEqual({
    text: '',
    files: [file],
  })
  expect(
    getInputControlState({
      groups: [{ label: 'Default', value: 'default', ratio: 1 }],
      hasAttachments: true,
      hasStopHandler: false,
      models: [{ label: 'GPT-4o', value: 'gpt-4o' }],
      text: '',
    }).canSubmit
  ).toBe(true)
})

test('attachment byte totals reflect decoded payload size', async () => {
  const attachments = await createMessageAttachments([
    {
      type: 'file',
      url: imageDataUrl,
      mediaType: 'image/png',
      filename: 'diagram.png',
    },
  ])

  expect(getDataUrlByteLength(imageDataUrl)).toBe(5)
  expect(getTotalAttachmentBytes(attachments)).toBe(5)
})
