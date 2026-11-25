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
import { MESSAGE_ROLES } from '../../constants'
import type { ChatCompletionRequest, UserPersona } from '../../types'

export function addPersonaContext(
  payload: ChatCompletionRequest,
  persona?: UserPersona
): ChatCompletionRequest {
  if (!persona || persona.id === 0) return payload

  const name = persona.name.trim()
  const traits = persona.traits.trim()
  if (!name && !traits) return payload

  const lines = [
    'Adopt the following roleplay persona for this conversation.',
    'Stay consistent with the persona while still following higher-priority safety and system instructions.',
  ]
  if (name) {
    lines.push(`Persona name: ${name}`)
  }
  if (traits) {
    lines.push(`Persona traits and background:\n${traits}`)
  }

  return {
    ...payload,
    messages: [
      {
        role: MESSAGE_ROLES.SYSTEM,
        content: lines.join('\n\n'),
      },
      ...payload.messages,
    ],
  }
}
