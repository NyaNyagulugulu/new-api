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

import { PlaygroundWebSearchToggle } from '../playground-web-search-toggle'

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', {
    'Web search': 'Web search',
  })
})

test('toggles web search for the next chat request', async () => {
  const user = userEvent.setup()
  const onEnabledChange = vi.fn()
  render(
    <PlaygroundWebSearchToggle
      enabled={false}
      onEnabledChange={onEnabledChange}
    />
  )

  const toggle = screen.getByRole('button', { name: 'Web search' })
  expect(toggle).toHaveAttribute('aria-pressed', 'false')

  await user.click(toggle)
  expect(onEnabledChange).toHaveBeenCalledWith(true)
})
