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
import { expect, test, vi } from 'vitest'

import { AuthenticatedLayout } from '../components/authenticated-layout'

const mocks = vi.hoisted(() => ({
  pathname: '/playground',
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => mocks.pathname,
}))

vi.mock('@/components/command-menu', () => ({
  CommandMenu: () => null,
}))

vi.mock('@/components/page-transition', () => ({
  AnimatedOutlet: () => <div data-testid='outlet' />,
}))

vi.mock('@/components/skip-to-main', () => ({
  SkipToMain: () => null,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarInset: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  SidebarProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/context/layout-provider', () => ({
  LayoutProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/context/search-provider', () => ({
  SearchProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/lib/cookies', () => ({
  getCookie: () => 'true',
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { auth: { user: { id: number } } }) => unknown
  ) => selector({ auth: { user: { id: 1 } } }),
}))

vi.mock('../components/app-header', () => ({
  AppHeader: ({ showSidebarTrigger }: { showSidebarTrigger: boolean }) => (
    <header data-sidebar-trigger={String(showSidebarTrigger)} />
  ),
}))

vi.mock('../components/app-sidebar', () => ({
  AppSidebar: () => <aside data-testid='app-sidebar' />,
}))

test('web chat hides the outer app sidebar and its header trigger', () => {
  mocks.pathname = '/playground'
  render(<AuthenticatedLayout />)

  expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
  expect(screen.getByRole('banner')).toHaveAttribute(
    'data-sidebar-trigger',
    'false'
  )
})

test('conversation permalinks use the same focused web chat layout', () => {
  mocks.pathname = '/c/6b062a5d-40e4-83e8-a783-5a6675934b43'
  render(<AuthenticatedLayout />)

  expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
  expect(screen.getByRole('banner')).toHaveAttribute(
    'data-sidebar-trigger',
    'false'
  )
})

test('other authenticated routes keep the app sidebar and trigger', () => {
  mocks.pathname = '/dashboard'
  render(<AuthenticatedLayout />)

  expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('banner')).toHaveAttribute(
    'data-sidebar-trigger',
    'true'
  )
})
