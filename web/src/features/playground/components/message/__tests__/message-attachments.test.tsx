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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { beforeAll, expect, test } from 'vitest'

import type { MessageAttachment } from '../../../types'
import { MessageAttachments } from '../message-attachments'

const attachments: MessageAttachment[] = [
  {
    id: 'image-1',
    kind: 'image',
    name: 'diagram.png',
    mediaType: 'image/png',
    dataUrl: 'data:image/png;base64,aGVsbG8=',
  },
  {
    id: 'file-1',
    kind: 'file',
    name: 'spec.pdf',
    mediaType: 'application/pdf',
    dataUrl: 'data:application/pdf;base64,aGVsbG8=',
  },
]

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', {
    Download: 'Download',
    'Preview image': 'Preview image',
  })
})

test('renders downloadable files and opens image previews', async () => {
  const user = userEvent.setup()
  render(<MessageAttachments attachments={attachments} />)

  expect(
    screen.getByRole('link', { name: 'Download: spec.pdf' })
  ).toHaveAttribute('download', 'spec.pdf')

  await user.click(
    screen.getByRole('button', { name: 'Preview image: diagram.png' })
  )

  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('img', { name: 'diagram.png' })).toBeVisible()
  expect(
    within(dialog).getByRole('link', { name: 'Download' })
  ).toHaveAttribute('href', attachments[0].dataUrl)
})
