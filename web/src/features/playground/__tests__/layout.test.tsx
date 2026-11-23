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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../constants'
import { Playground } from '../index'

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  navigate: vi.fn(),
  setOpen: vi.fn(),
  setOpenMobile: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouter: () => ({
    history: {
      back: mocks.back,
      canGoBack: () => true,
    },
  }),
}))

vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => ({
    open: true,
    setOpen: mocks.setOpen,
    setOpenMobile: mocks.setOpenMobile,
  }),
}))

vi.mock('@/features/playground/components/chat/playground-chat', () => ({
  PlaygroundChat: () => <div data-testid='web-chat' />,
}))

vi.mock(
  '@/features/playground/components/history/playground-history-sidebar',
  () => ({
    PlaygroundHistorySidebar: () => <div data-testid='history-sidebar' />,
  })
)

vi.mock('@/features/playground/components/input/playground-input', () => ({
  PlaygroundInput: () => <div data-testid='chat-input' />,
}))

vi.mock('../hooks', () => ({
  useChatHandler: () => ({
    sendChat: vi.fn(),
    stopGeneration: vi.fn(),
    isGenerating: false,
  }),
  usePlaygroundConversation: () => ({
    editingMessageKey: null,
    handleSendMessage: vi.fn(),
    handleRegenerateMessage: vi.fn(),
    handleEditMessage: vi.fn(),
    handleEditOpenChange: vi.fn(),
    applyEdit: vi.fn(),
    handleDeleteMessage: vi.fn(),
  }),
  usePlaygroundOptions: () => ({ isLoadingModels: false }),
  usePlaygroundState: () => ({
    config: DEFAULT_CONFIG,
    parameterEnabled: DEFAULT_PARAMETER_ENABLED,
    messages: [],
    activeSession: null,
    sessions: [],
    isLoadingMessages: false,
    models: [],
    groups: [],
    setModels: vi.fn(),
    setGroups: vi.fn(),
    updateConfig: vi.fn(),
    updateParameterEnabled: vi.fn(),
    updateMessages: vi.fn(),
    createNewChat: vi.fn(),
    selectChat: vi.fn(),
    renameChat: vi.fn(),
    deleteChat: vi.fn(),
  }),
}))

test('collapses the app sidebar, restores it on leave, and provides back navigation', async () => {
  const user = userEvent.setup()
  const { unmount } = render(<Playground />)

  await waitFor(() => expect(mocks.setOpen).toHaveBeenCalledWith(false))
  expect(mocks.setOpenMobile).toHaveBeenCalledWith(false)

  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(mocks.back).toHaveBeenCalledOnce()

  unmount()
  expect(mocks.setOpen).toHaveBeenLastCalledWith(true)
})
