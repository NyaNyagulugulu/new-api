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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TruncatedCell } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import dayjs from '@/lib/dayjs'

import type { ContentAuditLog } from '../api'
import {
  contentAuditKindLabel,
  contentAuditKindVariant,
  formatContentAuditSize,
} from '../lib/content-audit'
import { ContentAuditDetailsDialog } from './content-audit-details-dialog'

export function useContentAuditColumns(): ColumnDef<ContentAuditLog>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        size: 180,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {dayjs.unix(row.original.created_at).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        ),
        meta: { label: t('Time'), mobileTitle: true },
      },
      {
        accessorKey: 'username',
        header: t('Username'),
        size: 110,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-28'>
            {row.original.username || '—'}
          </TruncatedCell>
        ),
        meta: { label: t('Username') },
      },
      {
        accessorKey: 'kind',
        header: t('Content type'),
        size: 110,
        cell: ({ row }) => (
          <StatusBadge
            label={t(contentAuditKindLabel(row.original.kind))}
            variant={contentAuditKindVariant(row.original.kind)}
            copyable={false}
          />
        ),
        meta: { label: t('Content type'), mobileBadge: true },
      },
      {
        accessorKey: 'model_name',
        header: t('Model'),
        size: 170,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-44 font-mono'>
            {row.original.model_name || '—'}
          </TruncatedCell>
        ),
        meta: { label: t('Model') },
      },
      {
        id: 'route',
        header: t('Route'),
        size: 210,
        accessorFn: (entry) => `${entry.method} ${entry.path}`,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-56 font-mono'>
            {row.original.method} {row.original.path}
          </TruncatedCell>
        ),
        meta: { label: t('Route'), mobileHidden: true },
      },
      {
        id: 'size',
        header: t('Stored size'),
        size: 120,
        accessorFn: (entry) => entry.request_size + entry.response_size,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {formatContentAuditSize(
              row.original.request_size + row.original.response_size
            )}
          </span>
        ),
        meta: { label: t('Stored size'), mobileHidden: true },
      },
      {
        accessorKey: 'status_code',
        header: 'HTTP',
        size: 70,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {row.original.status_code}
          </span>
        ),
        meta: { label: 'HTTP' },
      },
      {
        id: 'details',
        header: t('Details'),
        size: 70,
        enableHiding: false,
        cell: ({ row }) => <ContentAuditDetailsDialog entry={row.original} />,
        meta: { label: t('Details') },
      },
    ],
    [t]
  )
}
