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
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { beforeAll, expect, test, vi } from 'vitest'

import { PlaygroundReasoningSelector } from '../playground-reasoning-selector'

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', {
    Auto: 'Auto',
    'Reasoning effort': 'Reasoning effort',
    Maximum: 'Maximum',
  })
})

test('changes reasoning effort by dragging the horizontal slider', async () => {
  const user = userEvent.setup()
  const onValueChange = vi.fn()
  render(<PlaygroundReasoningSelector onValueChange={onValueChange} value='' />)

  await user.click(screen.getByRole('button', { name: 'Reasoning effort' }))
  const sliderGroup = screen.getByRole('group', { name: 'Reasoning effort' })
  const slider = sliderGroup.querySelector<HTMLInputElement>(
    'input[type="range"]'
  )
  if (!slider) throw new Error('Reasoning slider input not found')
  fireEvent.change(slider, { target: { value: '7' } })

  expect(onValueChange).toHaveBeenLastCalledWith('max')
})
