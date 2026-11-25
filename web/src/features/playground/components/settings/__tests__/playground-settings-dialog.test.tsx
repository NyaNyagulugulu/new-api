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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { beforeAll, beforeEach, expect, test, vi } from 'vitest'

import type { UserMemory } from '../../../types'
import { PlaygroundSettingsDialog } from '../playground-settings-dialog'

const apiMocks = vi.hoisted(() => ({
  deleteAllUserMemories: vi.fn(),
  deleteUserMemory: vi.fn(),
  getUserMemoryList: vi.fn(),
}))

vi.mock('../../../api', () => ({
  deleteAllUserMemories: apiMocks.deleteAllUserMemories,
  deleteUserMemory: apiMocks.deleteUserMemory,
  getUserMemoryList: apiMocks.getUserMemoryList,
}))

const memories: UserMemory[] = [
  {
    id: 7,
    content: 'Prefers concise answers.',
    keywords: 'style,answers',
    category: 'preference',
    importance: 0.8,
    conversation_id: 'chat-1',
    source_key: 'source-1',
    status: 'active',
    created_at: 1,
    updated_at: 1,
  },
]

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', {
    'All memories cleared': 'All memories cleared',
    'Clear all memories': 'Clear all memories',
    'Clear all memories?': 'Clear all memories?',
    Delete: 'Delete',
    'Delete memory': 'Delete memory',
    'Delete memory?': 'Delete memory?',
    'Failed to load memories': 'Failed to load memories',
    Importance: 'Importance',
    'Manage how WebChat remembers useful details from your conversations.':
      'Manage how WebChat remembers useful details from your conversations.',
    'Memory deleted': 'Memory deleted',
    'Memory management': 'Memory management',
    'No memories yet': 'No memories yet',
    Settings: 'Settings',
    'This memory will be permanently deleted. This cannot be undone.':
      'This memory will be permanently deleted. This cannot be undone.',
    'This will permanently delete every saved memory. This cannot be undone.':
      'This will permanently delete every saved memory. This cannot be undone.',
    Updated: 'Updated',
    'WebChat can remember useful details from your conversations. Review what is stored or clear it at any time.':
      'WebChat can remember useful details from your conversations. Review what is stored or clear it at any time.',
    'WebChat will save useful long-term details from your conversations here.':
      'WebChat will save useful long-term details from your conversations here.',
  })
})

beforeEach(() => {
  apiMocks.getUserMemoryList.mockResolvedValue(memories)
  apiMocks.deleteUserMemory.mockResolvedValue(undefined)
  apiMocks.deleteAllUserMemories.mockResolvedValue(1)
})

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PlaygroundSettingsDialog onOpenChange={() => undefined} open />
    </QueryClientProvider>
  )
}

test('lists saved memories with their category, importance, and updated time', async () => {
  renderDialog()

  expect(await screen.findByText('Prefers concise answers.')).toBeVisible()
  expect(screen.getByText('preference')).toBeVisible()
  expect(screen.getByText(/Importance: 80%/)).toBeVisible()
  expect(screen.getByText(/Updated:/)).toBeVisible()
})

test('allows deleting one memory after confirmation', async () => {
  const user = userEvent.setup()
  renderDialog()

  await user.click(await screen.findByRole('button', { name: 'Delete memory' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))

  await waitFor(() => expect(apiMocks.deleteUserMemory).toHaveBeenCalledWith(7))
})

test('allows clearing every memory after confirmation', async () => {
  const user = userEvent.setup()
  renderDialog()

  await user.click(
    await screen.findByRole('button', { name: 'Clear all memories' })
  )
  expect(screen.getByText('Clear all memories?')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Delete' }))

  await waitFor(() =>
    expect(apiMocks.deleteAllUserMemories).toHaveBeenCalledOnce()
  )
})
