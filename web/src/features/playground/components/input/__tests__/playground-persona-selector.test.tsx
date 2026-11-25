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

import { PlaygroundPersonaSelector } from '../playground-persona-selector'

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', {
    'Default persona': 'Default persona',
    Persona: 'Persona',
  })
})

test('changes the active persona from the WebChat composer', async () => {
  const user = userEvent.setup()
  const onValueChange = vi.fn()
  render(
    <PlaygroundPersonaSelector
      onValueChange={onValueChange}
      personas={[
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
      ]}
      value={0}
    />
  )

  await user.click(screen.getByRole('button', { name: 'Persona' }))
  await user.click(screen.getByRole('button', { name: 'Luna' }))

  expect(onValueChange).toHaveBeenCalledWith(7)
})
