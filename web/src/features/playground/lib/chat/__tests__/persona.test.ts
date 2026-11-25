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
import { expect, test } from 'vitest'

import type { ChatCompletionRequest, UserPersona } from '../../../types'
import { addPersonaContext } from '../persona'

const payload: ChatCompletionRequest = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true,
}

const persona: UserPersona = {
  id: 7,
  name: 'Luna',
  traits: 'Calm, precise, and uses short sentences.',
  is_default: false,
  created_at: 1,
  updated_at: 1,
}

test('keeps the default empty persona out of the model prompt', () => {
  expect(
    addPersonaContext(payload, {
      ...persona,
      id: 0,
      name: '',
      traits: '',
      is_default: true,
    })
  ).toBe(payload)
})

test('injects a selected persona as a system instruction', () => {
  const result = addPersonaContext(payload, persona)

  expect(result.messages[0]).toEqual({
    role: 'system',
    content: expect.stringContaining('Persona name: Luna'),
  })
  expect(result.messages[0].content).toContain('Calm, precise')
  expect(result.messages.at(-1)).toEqual(payload.messages[0])
})
