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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, expect, test, vi } from 'vitest'

import type { ChatImportResult } from '../../../types'
import { PlaygroundImportDialog } from '../playground-import-dialog'

const apiMocks = vi.hoisted(() => ({
  importChatConversations: vi.fn(),
}))

vi.mock('../../../api', () => ({
  importChatConversations: apiMocks.importChatConversations,
}))

const result: ChatImportResult = {
  sessions: [
    {
      id: 'conversation-1',
      title: 'Imported conversation',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  found: 1,
  imported: 1,
  skipped: 0,
}

beforeEach(() => {
  apiMocks.importChatConversations.mockReset()
  apiMocks.importChatConversations.mockResolvedValue(result)
})

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const onImported = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <PlaygroundImportDialog
        onImported={onImported}
        onOpenChange={onOpenChange}
        open
      />
    </QueryClientProvider>
  )
  return { onImported, onOpenChange }
}

function importButton() {
  return within(screen.getByRole('dialog')).getByRole('button', {
    name: 'Import',
  })
}

test('imports conversations from a public export URL', async () => {
  const user = userEvent.setup()
  const callbacks = renderDialog()
  const url = 'https://downloads.example.com/conversations.zip'

  await user.type(
    screen.getByRole('textbox', { name: 'Export download URL' }),
    url
  )
  await user.click(importButton())

  await waitFor(() =>
    expect(apiMocks.importChatConversations).toHaveBeenCalledWith({ url })
  )
  expect(callbacks.onImported).toHaveBeenCalledWith(result)
  expect(callbacks.onOpenChange).toHaveBeenCalledWith(false)
})

test('imports conversations from an uploaded export file', async () => {
  const user = userEvent.setup()
  const callbacks = renderDialog()
  const file = new File(['archive'], 'deepseek.zip', {
    type: 'application/zip',
  })

  await user.click(screen.getByRole('tab', { name: 'Upload file' }))
  await user.upload(screen.getByLabelText('Conversation export file'), file)
  await user.click(importButton())

  await waitFor(() =>
    expect(apiMocks.importChatConversations).toHaveBeenCalledWith({ file })
  )
  expect(callbacks.onImported).toHaveBeenCalledWith(result)
})

test('keeps the dialog open and reports an import failure', async () => {
  const user = userEvent.setup()
  const callbacks = renderDialog()
  const errorToast = vi.spyOn(toast, 'error')
  apiMocks.importChatConversations.mockRejectedValue({
    response: {
      data: {
        success: false,
        message_key: 'Failed to import conversations',
      },
    },
  })

  await user.type(
    screen.getByRole('textbox', { name: 'Export download URL' }),
    'https://downloads.example.com/unreadable.zip'
  )
  await user.click(importButton())

  await waitFor(() =>
    expect(errorToast).toHaveBeenCalledWith('Failed to import conversations')
  )
  expect(callbacks.onImported).not.toHaveBeenCalled()
  expect(callbacks.onOpenChange).not.toHaveBeenCalledWith(false)
  expect(screen.getByRole('dialog')).toBeVisible()
})

test('does not import an empty export', async () => {
  const user = userEvent.setup()
  const callbacks = renderDialog()
  const errorToast = vi.spyOn(toast, 'error')
  apiMocks.importChatConversations.mockResolvedValue({
    sessions: [],
    found: 0,
    imported: 0,
    skipped: 0,
  })

  await user.type(
    screen.getByRole('textbox', { name: 'Export download URL' }),
    'https://downloads.example.com/empty.zip'
  )
  await user.click(importButton())

  await waitFor(() =>
    expect(errorToast).toHaveBeenCalledWith(
      'No conversations were found in this import'
    )
  )
  expect(callbacks.onImported).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeVisible()
})
