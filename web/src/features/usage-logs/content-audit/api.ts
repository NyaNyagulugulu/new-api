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
import type { ApiResponse } from '@/features/profile/types'
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

export type ContentAuditPart = 'request' | 'response' | 'websocket'

export interface ContentAuditLog {
  id: number
  event_id: string
  request_id: string
  user_id: number
  username: string
  token_id: number
  token_name: string
  channel_id: number
  channel_name: string
  created_at: number
  expires_at: number
  method: string
  path: string
  kind: string
  model_name: string
  group: string
  ip: string
  user_agent: string
  status_code: number
  success: boolean
  is_stream: boolean
  request_content_type: string
  response_content_type: string
  request_size: number
  response_size: number
  request_sha256: string
  response_sha256: string
  websocket_size: number
  websocket_sha256: string
  node_name: string
  has_request: boolean
  has_response: boolean
  has_websocket: boolean
}

export interface ContentAuditDetail extends ContentAuditLog {
  request_preview: string
  response_preview: string
  request_text?: string
  response_text?: string
  websocket_text?: string
}

export interface ContentAuditFilters {
  p: number
  page_size: number
  start_timestamp?: number
  end_timestamp?: number
  success?: string
  kind?: string
  username?: string
  user_id?: number
  model_name?: string
  request_id?: string
  ip?: string
  q?: string
}

export async function getContentAuditLogs(
  params: ContentAuditFilters
): Promise<{ items: ContentAuditLog[]; total: number }> {
  const response = await api.get<
    ApiResponse<{ items: ContentAuditLog[]; total: number }>
  >('/api/content_audit/', { params })
  if (!response.data.success || !response.data.data) {
    throw createServerError(
      response.data,
      'Failed to load content audit records'
    )
  }
  return response.data.data
}

export async function getContentAuditLogDetail(
  eventId: string
): Promise<ContentAuditDetail> {
  const response = await api.get<ApiResponse<ContentAuditDetail>>(
    `/api/content_audit/${eventId}`
  )
  if (!response.data.success || !response.data.data) {
    throw createServerError(
      response.data,
      'Failed to load content audit record'
    )
  }
  return response.data.data
}

export async function getContentAuditContent(
  eventId: string,
  part: ContentAuditPart
): Promise<Blob> {
  const response = await api.get<Blob>(
    `/api/content_audit/${eventId}/${part}`,
    {
      params: { inline: 1 },
      responseType: 'blob',
    }
  )
  return response.data
}
