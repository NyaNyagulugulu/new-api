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
import { useQuery } from '@tanstack/react-query'

import { getUserPersonas } from '../api'
import type { UserPersona } from '../types'

export const PERSONA_QUERY_KEY = ['playground', 'personas'] as const
export const DEFAULT_PERSONA: UserPersona = {
  id: 0,
  name: '',
  traits: '',
  is_default: true,
  created_at: 0,
  updated_at: 0,
}

export function usePersonas() {
  return useQuery({
    queryKey: PERSONA_QUERY_KEY,
    queryFn: getUserPersonas,
    placeholderData: [DEFAULT_PERSONA],
    staleTime: 60_000,
  })
}
