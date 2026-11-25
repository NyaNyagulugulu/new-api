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
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Main } from '@/components/layout'
import { Playground } from '@/features/playground'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'

const CHAT_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export const Route = createFileRoute('/_authenticated/c/$conversationId')({
  beforeLoad: ({ params }) => {
    if (!isSidebarModuleEnabled('chat', 'playground')) {
      throw redirect({ to: '/' })
    }
    if (!CHAT_SESSION_ID_PATTERN.test(params.conversationId)) {
      throw redirect({ to: '/playground' })
    }
  },
  component: ChatConversationPage,
})

function ChatConversationPage() {
  const { conversationId } = Route.useParams()

  return (
    <Main className='h-full p-0'>
      <Playground conversationId={conversationId} />
    </Main>
  )
}
