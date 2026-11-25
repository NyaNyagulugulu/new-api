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
import { expect, test, vi } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../constants'
import { Playground } from '../index'

const mocks = vi.hoisted(() => ({
  importConversations: vi.fn(),
  navigate: vi.fn(),
  selectChat: vi.fn(),
  stopGeneration: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/features/pricing/hooks/use-pricing-data', () => ({
  usePricingData: () => ({ models: [] }),
}))

vi.mock('@/features/playground/components/chat/playground-chat', () => ({
  PlaygroundChat: () => <div data-testid='web-chat' />,
}))

vi.mock(
  '@/features/playground/components/history/playground-history-sidebar',
  () => ({
    PlaygroundHistorySidebar: ({
      onSelectChat,
    }: {
      onSelectChat: (sessionId: string) => void
    }) => (
      <button onClick={() => onSelectChat('chat-2')} type='button'>
        Other chat
      </button>
    ),
  })
)

vi.mock('@/features/playground/components/input/playground-input', () => ({
  PlaygroundInput: ({ disabled }: { disabled?: boolean }) => (
    <div data-disabled={String(Boolean(disabled))} data-testid='chat-input' />
  ),
}))

vi.mock(
  '@/features/playground/components/history/playground-import-dialog',
  () => ({
    PlaygroundImportDialog: ({
      open,
      onOpenChange,
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
    }) =>
      open ? (
        <button onClick={() => onOpenChange(false)} type='button'>
          Close import dialog
        </button>
      ) : null,
  })
)

vi.mock('../hooks', () => ({
  useAiChatTitles: vi.fn(),
  useLongTermMemoryReflection: vi.fn(),
  useMemorySettings: () => undefined,
  usePersonas: () => ({
    data: [
      {
        id: 0,
        name: '',
        traits: '',
        is_default: true,
        created_at: 0,
        updated_at: 0,
      },
    ],
  }),
  useChatHandler: () => ({
    sendChat: vi.fn(),
    stopGeneration: mocks.stopGeneration,
    generatingSessionIds: new Set(['chat-1']),
  }),
  usePlaygroundConversation: () => ({
    editingMessageKey: null,
    handleSendMessage: vi.fn(),
    handleRegenerateMessage: vi.fn(),
    handleEditMessage: vi.fn(),
    handleEditOpenChange: vi.fn(),
    applyEdit: vi.fn(),
    handleDeleteMessage: vi.fn(),
    handleSwitchMessageVersion: vi.fn(),
  }),
  usePlaygroundOptions: () => ({ isLoadingModels: false }),
  usePlaygroundState: () => ({
    config: DEFAULT_CONFIG,
    parameterEnabled: DEFAULT_PARAMETER_ENABLED,
    messages: [],
    activeSession: {
      id: 'chat-2',
      title: 'Other chat',
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    },
    sessions: [],
    visibleSessions: [],
    isLoadingMessages: false,
    hasMoreSessions: false,
    isLoadingMoreSessions: false,
    models: [],
    groups: [],
    setModels: vi.fn(),
    setGroups: vi.fn(),
    updateConfig: vi.fn(),
    updateParameterEnabled: vi.fn(),
    updateMessages: vi.fn(),
    createNewChat: vi.fn(),
    selectChat: mocks.selectChat,
    loadMoreSessions: vi.fn(),
    renameChat: vi.fn(),
    deleteChat: vi.fn(),
    importConversations: mocks.importConversations,
  }),
}))

test('returns to the dashboard overview from the web chat header', async () => {
  const user = userEvent.setup()
  render(<Playground />)
  mocks.navigate.mockClear()

  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' })
})

test('opens the active conversation at its permalink', () => {
  render(<Playground />)

  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/c/$conversationId',
    params: { conversationId: 'chat-2' },
    replace: true,
  })
})

test('switching conversations while generating keeps the active stream running', async () => {
  const user = userEvent.setup()
  render(<Playground />)

  await user.click(screen.getByRole('button', { name: 'Other chat' }))

  expect(mocks.stopGeneration).not.toHaveBeenCalled()
  expect(mocks.selectChat).toHaveBeenCalledWith('chat-2')
  expect(screen.getByTestId('chat-input')).toHaveAttribute(
    'data-disabled',
    'false'
  )
})

test('opens the conversation import dialog from the web chat header', async () => {
  const user = userEvent.setup()
  render(<Playground />)

  await user.click(screen.getByRole('button', { name: 'Import conversations' }))

  expect(
    screen.getByRole('button', { name: 'Close import dialog' })
  ).toBeVisible()
})
