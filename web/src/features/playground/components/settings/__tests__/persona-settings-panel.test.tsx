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
import { beforeEach, expect, test, vi } from 'vitest'

import type { UserPersona } from '../../../types'
import { PersonaSettingsPanel } from '../persona-settings-panel'

const apiMocks = vi.hoisted(() => ({
  createUserPersona: vi.fn(),
  deleteUserPersona: vi.fn(),
  getUserPersonas: vi.fn(),
  updateUserPersona: vi.fn(),
}))

vi.mock('../../../api', () => ({
  createUserPersona: apiMocks.createUserPersona,
  deleteUserPersona: apiMocks.deleteUserPersona,
  getUserPersonas: apiMocks.getUserPersonas,
  updateUserPersona: apiMocks.updateUserPersona,
}))

const personas: UserPersona[] = [
  {
    id: 0,
    name: '',
    traits: '',
    is_default: true,
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 7,
    name: 'Luna',
    traits: 'Calm assistant',
    is_default: false,
    created_at: 1,
    updated_at: 1,
  },
]

beforeEach(() => {
  apiMocks.getUserPersonas.mockResolvedValue(personas)
  apiMocks.createUserPersona.mockResolvedValue(personas[1])
  apiMocks.updateUserPersona.mockResolvedValue(undefined)
  apiMocks.deleteUserPersona.mockResolvedValue(undefined)
})

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PersonaSettingsPanel />
    </QueryClientProvider>
  )
}

test('always shows the built-in default persona without delete controls', async () => {
  renderPanel()

  expect(await screen.findByText('Default persona')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /Delete persona: Default persona/ })
  ).not.toBeInTheDocument()
})

test('creates a persona from the character name and traits form', async () => {
  const user = userEvent.setup()
  renderPanel()

  await user.click(screen.getByRole('button', { name: 'New persona' }))
  await user.type(screen.getByLabelText('Character name'), 'Mika')
  await user.type(
    screen.getByLabelText('Character traits'),
    'Cheerful and direct'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() =>
    expect(apiMocks.createUserPersona).toHaveBeenCalledWith({
      name: 'Mika',
      traits: 'Cheerful and direct',
    })
  )
})

test('deletes a custom persona after explicit confirmation', async () => {
  const user = userEvent.setup()
  renderPanel()

  await user.click(
    await screen.findByRole('button', { name: 'Delete persona: Luna' })
  )
  await user.click(screen.getByRole('button', { name: 'Delete' }))

  await waitFor(() =>
    expect(apiMocks.deleteUserPersona).toHaveBeenCalledWith(7)
  )
})
