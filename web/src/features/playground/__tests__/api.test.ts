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
import { expect, test, vi } from 'vitest'

import { getMemorySettings, searchUserMemories } from '../api'

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    get: apiMocks.get,
    post: apiMocks.post,
  },
}))

test('unwraps memory settings from the API success envelope', async () => {
  apiMocks.get.mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: true,
        auto_extract: true,
        extract_every_rounds: 1,
        extract_window_messages: 40,
        retrieve_limit: 5,
        max_injected_chars: 3000,
        min_importance: 0.25,
        retention_days: 365,
        embedding_enabled: true,
        embedding_model: 'embedding-test',
        embedding_group: '',
        min_similarity: 0.45,
        vector_weight: 0.5,
      },
    },
  })

  await expect(getMemorySettings()).resolves.toMatchObject({
    enabled: true,
    embedding_model: 'embedding-test',
  })
})

test('unwraps memory search results from the API success envelope', async () => {
  apiMocks.post.mockResolvedValue({
    data: {
      success: true,
      data: [{ id: 1, content: 'Preferred name is Hachimi' }],
    },
  })

  await expect(
    searchUserMemories('what is my name', 'default', 3)
  ).resolves.toEqual([{ id: 1, content: 'Preferred name is Hachimi' }])
  expect(apiMocks.post).toHaveBeenCalledWith(
    '/api/user/self/memories/search',
    {
      query: 'what is my name',
      group: 'default',
      persona_id: 3,
    },
    expect.objectContaining({ signal: undefined })
  )
})
