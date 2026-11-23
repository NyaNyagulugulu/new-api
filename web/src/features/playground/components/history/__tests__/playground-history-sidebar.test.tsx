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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { beforeAll, expect, test, vi } from 'vitest'

import type { ChatSession } from '../../../types'
import { PlaygroundHistorySidebar } from '../playground-history-sidebar'

const sessionMessage = (key: string, content: string) => ({
  key,
  from: 'user' as const,
  versions: [{ id: `${key}-version`, content }],
})

const sessions: ChatSession[] = [
  {
    id: 'chat-1',
    title: 'Database indexes',
    messages: [sessionMessage('message-1', 'Explain database indexes')],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'chat-2',
    title: 'Travel plan',
    messages: [sessionMessage('message-2', 'Plan a short trip')],
    createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
  },
]

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', {
    'AI can make mistakes. Check important information.':
      'AI can make mistakes. Check important information.',
    Cancel: 'Cancel',
    'Chat deleted': 'Chat deleted',
    'Chat history': 'Chat history',
    'Chat options': 'Chat options',
    'Chat renamed': 'Chat renamed',
    'Chat title': 'Chat title',
    Delete: 'Delete',
    'Delete chat?': 'Delete chat?',
    'New chat': 'New chat',
    'No chats found': 'No chats found',
    'No chats yet': 'No chats yet',
    Older: 'Older',
    'Previous 7 days': 'Previous 7 days',
    Rename: 'Rename',
    'Rename chat': 'Rename chat',
    Save: 'Save',
    'Search chats': 'Search chats',
    Today: 'Today',
    'Try a different search term.': 'Try a different search term.',
    Yesterday: 'Yesterday',
  })
})

function renderSidebar(
  overrides: {
    onNewChat?: () => void
    onSelectChat?: (sessionId: string) => void
    onRenameChat?: (sessionId: string, title: string) => void
  } = {}
) {
  return render(
    <PlaygroundHistorySidebar
      activeSessionId='chat-1'
      onDeleteChat={() => undefined}
      onNewChat={overrides.onNewChat ?? (() => undefined)}
      onRenameChat={overrides.onRenameChat ?? (() => undefined)}
      onSelectChat={overrides.onSelectChat ?? (() => undefined)}
      sessions={sessions}
    />
  )
}

test('search filters the visible conversation list', async () => {
  const user = userEvent.setup()
  renderSidebar()

  expect(screen.getByText('Travel plan')).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Search chats' }), 'data')

  expect(screen.getByText('Database indexes')).toBeInTheDocument()
  expect(screen.queryByText('Travel plan')).not.toBeInTheDocument()
})

test('starting or selecting a chat invokes the requested navigation', async () => {
  const user = userEvent.setup()
  const onNewChat = vi.fn()
  const onSelectChat = vi.fn()
  renderSidebar({ onNewChat, onSelectChat })

  await user.click(screen.getByRole('button', { name: 'New chat' }))
  await user.click(screen.getByRole('button', { name: 'Travel plan' }))

  expect(onNewChat).toHaveBeenCalledOnce()
  expect(onSelectChat).toHaveBeenCalledWith('chat-2')
})

test('renaming a conversation saves the new title', async () => {
  const user = userEvent.setup()
  const onRenameChat = vi.fn()
  renderSidebar({ onRenameChat })

  await user.click(
    screen.getByRole('button', { name: 'Chat options: Database indexes' })
  )
  await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

  const input = screen.getByRole('textbox', { name: 'Chat title' })
  await user.clear(input)
  await user.type(input, 'Index notes')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(onRenameChat).toHaveBeenCalledWith('chat-1', 'Index notes')
})
