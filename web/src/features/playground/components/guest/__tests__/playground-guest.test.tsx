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
import i18next from 'i18next'
import { beforeAll, expect, test, vi } from 'vitest'

import { PlaygroundGuest } from '../playground-guest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children?: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/components/layout', () => ({
  PublicLayout: ({ children }: { children: React.ReactNode }) => children,
}))

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', {
    'AI can make mistakes. Check important information.':
      'AI can make mistakes. Check important information.',
    'A clean web chat for every model': 'A clean web chat for every model',
    'Chat naturally with any available model, attach images and files, choose reasoning effort, and review token usage and cost after every reply.':
      'Chat naturally with any available model, attach images and files, choose reasoning effort, and review token usage and cost after every reply.',
    'Explore models': 'Explore models',
    'Images & files': 'Images & files',
    'Reasoning levels': 'Reasoning levels',
    'Sign in to ask anything': 'Sign in to ask anything',
    'Sign in to start chatting': 'Sign in to start chatting',
    'Token usage & cost': 'Token usage & cost',
  })
})

test('lets signed-out visitors view WebChat and sign in to continue', () => {
  render(<PlaygroundGuest />)

  expect(
    screen.getByRole('heading', {
      name: 'A clean web chat for every model',
    })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: /Sign in to start chatting/ })
  ).toHaveAttribute('href', '/sign-in')
  expect(
    screen.getByRole('link', { name: /Sign in to ask anything/ })
  ).toHaveAttribute('href', '/sign-in')
})
