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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { ContentAuditLogs } from '..'
import type { ContentAuditLog } from '../api'
import { ContentAuditDetailsDialog } from '../components/content-audit-details-dialog'
import { buildContentAuditConversation } from '../lib/conversation'

const entry: ContentAuditLog = {
  id: 1,
  event_id: '0123456789abcdef0123456789abcdef',
  request_id: 'request-1',
  user_id: 7,
  username: 'audit-user',
  token_id: 11,
  token_name: 'audit-token',
  channel_id: 21,
  channel_name: 'audit-channel',
  created_at: 1788600600,
  expires_at: 1788600600 + 30 * 24 * 60 * 60,
  method: 'POST',
  path: '/v1/chat/completions',
  kind: 'chat',
  model_name: 'gpt-audit',
  group: 'default',
  ip: '192.0.2.1',
  user_agent: 'audit-test',
  status_code: 200,
  success: true,
  is_stream: false,
  request_content_type: 'application/json',
  response_content_type: 'application/json',
  request_size: 20,
  response_size: 24,
  request_sha256: '',
  response_sha256: '',
  websocket_size: 0,
  websocket_sha256: '',
  node_name: 'node-a',
  has_request: true,
  has_response: true,
  has_websocket: false,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.setUser(null)
})

async function renderDialog() {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ContentAuditDetailsDialog entry={entry} />
      </I18nextProvider>
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Details' }))
  return screen.findByRole('dialog', { name: 'Retained content' })
}

it('renders retained chat as a conversation without executing content', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === `/api/content_audit/${entry.event_id}`) {
      return {
        data: {
          success: true,
          data: {
            ...entry,
            request_preview: 'retained request prompt',
            response_preview: 'retained response',
          },
        },
      } as never
    }
    if (url.endsWith('/request')) {
      return {
        data: new Blob(
          [
            JSON.stringify({
              model: 'gpt-audit',
              messages: [
                {
                  role: 'user',
                  content: '<script>retained request prompt</script>',
                },
              ],
            }),
          ],
          { type: 'application/json' }
        ),
      } as never
    }
    if (url.endsWith('/response')) {
      return {
        data: new Blob(
          [
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'retained response',
                  },
                },
              ],
            }),
          ],
          { type: 'application/json' }
        ),
      } as never
    }
    throw new Error(`unexpected request: ${url}`)
  })
  const dialog = await renderDialog()
  expect(
    await within(dialog).findByText('<script>retained request prompt</script>')
  ).toBeVisible()
  expect(await within(dialog).findByText('retained response')).toBeVisible()
  expect(within(dialog).getByText('User')).toBeVisible()
  expect(within(dialog).getByText('Assistant')).toBeVisible()
  expect(dialog.querySelector('script')).toBeNull()
})

it('parses Responses SSE into readable reasoning, text, and tool calls', () => {
  const conversation = buildContentAuditConversation({
    kind: 'responses',
    requestText: JSON.stringify({
      model: 'gpt-audit',
      input: 'inspect the repository',
    }),
    requestContentType: 'application/json',
    responseText: [
      'event: response.reasoning_text.delta',
      'data: {"type":"response.reasoning_text.delta","delta":"Thinking through the task"}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Final answer"}',
      '',
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"call-1","name":"exec_command","arguments":""}}',
      '',
      'event: response.function_call_arguments.delta',
      'data: {"type":"response.function_call_arguments.delta","item_id":"call-1","delta":"{\\"cmd\\":\\"pwd\\"}"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'),
    responseContentType: 'text/event-stream',
  })
  expect(conversation.parseMode).toBe('conversation')
  expect(conversation.messages[0]).toMatchObject({
    role: 'user',
    text: 'inspect the repository',
  })
  expect(conversation.messages[1]).toMatchObject({
    role: 'assistant',
    text: 'Final answer',
    reasoning: 'Thinking through the task',
  })
  expect(conversation.messages[1].tools[0]).toMatchObject({
    id: 'call-1',
    name: 'exec_command',
    arguments: '{"cmd":"pwd"}',
  })
})

it('classifies Responses history tool and reasoning items as assistant/tool roles', () => {
  const conversation = buildContentAuditConversation({
    kind: 'responses',
    requestText: JSON.stringify({
      input: [
        { type: 'message', role: 'user', content: 'inspect files' },
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Need to inspect files' }],
        },
        {
          type: 'function_call',
          id: 'call-1',
          name: 'exec_command',
          arguments: '{"cmd":"ls"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: 'README.md',
        },
      ],
    }),
    requestContentType: 'application/json',
    responseContentType: 'application/json',
  })
  expect(conversation.messages.map((message) => message.role)).toEqual([
    'user',
    'assistant',
    'assistant',
    'tool',
  ])
  expect(conversation.messages[1].reasoning).toBe('Need to inspect files')
  expect(conversation.messages[2].tools[0]).toMatchObject({
    id: 'call-1',
    name: 'exec_command',
    arguments: '{"cmd":"ls"}',
  })
  expect(conversation.messages[3].tools[0]).toMatchObject({
    id: 'call-1',
    name: 'tool',
    output: 'README.md',
  })
})

it('denies the page when content audit permission is missing', async () => {
  useAuthStore.getState().auth.setUser({
    id: 2,
    username: 'admin-without-content-audit',
    role: 10,
    permissions: { admin_permissions: { content_audit: { read: false } } },
  } as never)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en } })
  render(
    <I18nextProvider i18n={i18n}>
      <ContentAuditLogs />
    </I18nextProvider>
  )
  expect(screen.getByText('Access denied')).toBeVisible()
  expect(
    screen.getByText(
      'You do not have permission to view retained relay content.'
    )
  ).toBeVisible()
})
