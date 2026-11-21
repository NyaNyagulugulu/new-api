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
import type { Table } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/ui/combobox'

import { CompactDateTimeRangePicker } from '../../components/compact-date-time-range-picker'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '../../components/logs-filter-toolbar'
import type { ContentAuditFilters, ContentAuditLog } from '../api'
import {
  CONTENT_AUDIT_KINDS,
  contentAuditKindLabel,
} from '../lib/content-audit'

function ContentAuditFilterSelect(props: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <LogsFilterField>
      <Combobox
        options={props.options}
        value={props.value}
        onValueChange={(value) => {
          if (value !== null) props.onChange(value)
        }}
        aria-label={props.label}
        className='w-full'
      />
    </LogsFilterField>
  )
}

export function ContentAuditFilterBar(props: {
  table: Table<ContentAuditLog>
  filters: ContentAuditFilters
  onChange: (patch: Partial<ContentAuditFilters>) => void
  isFetching: boolean
  onSearch: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const dateFilter = (
    <LogsFilterField wide>
      <CompactDateTimeRangePicker
        start={
          props.filters.start_timestamp === undefined
            ? undefined
            : new Date(props.filters.start_timestamp * 1000)
        }
        end={
          props.filters.end_timestamp === undefined
            ? undefined
            : new Date(props.filters.end_timestamp * 1000)
        }
        onChange={({ start, end }) =>
          props.onChange({
            start_timestamp: start
              ? Math.floor(start.getTime() / 1000)
              : undefined,
            end_timestamp: end ? Math.floor(end.getTime() / 1000) : undefined,
          })
        }
      />
    </LogsFilterField>
  )
  const mainFilters = (
    <>
      <ContentAuditFilterSelect
        label={t('Content type')}
        value={props.filters.kind ?? 'all'}
        options={[
          { value: 'all', label: t('All content types') },
          ...CONTENT_AUDIT_KINDS.map((kind) => ({
            value: kind,
            label: t(contentAuditKindLabel(kind)),
          })),
        ]}
        onChange={(value) =>
          props.onChange({ kind: value === 'all' ? undefined : value })
        }
      />
      <ContentAuditFilterSelect
        label={t('Result')}
        value={props.filters.success ?? 'all'}
        options={[
          { value: 'all', label: t('All results') },
          { value: 'true', label: t('Success') },
          { value: 'false', label: t('Failed') },
        ]}
        onChange={(value) =>
          props.onChange({ success: value === 'all' ? undefined : value })
        }
      />
    </>
  )
  const advancedFilters = (
    <>
      <LogsFilterField>
        <LogsFilterInput
          aria-label={t('Username')}
          placeholder={t('Username')}
          value={props.filters.username ?? ''}
          onChange={(event) =>
            props.onChange({ username: event.target.value || undefined })
          }
        />
      </LogsFilterField>
      <LogsFilterField>
        <LogsFilterInput
          aria-label={t('Model')}
          placeholder={t('Model')}
          value={props.filters.model_name ?? ''}
          onChange={(event) =>
            props.onChange({ model_name: event.target.value || undefined })
          }
        />
      </LogsFilterField>
      <LogsFilterField>
        <LogsFilterInput
          aria-label={t('Request ID')}
          placeholder={t('Request ID')}
          value={props.filters.request_id ?? ''}
          onChange={(event) =>
            props.onChange({ request_id: event.target.value || undefined })
          }
        />
      </LogsFilterField>
      <LogsFilterField>
        <LogsFilterInput
          aria-label='IP'
          placeholder='IP'
          value={props.filters.ip ?? ''}
          onChange={(event) =>
            props.onChange({ ip: event.target.value || undefined })
          }
        />
      </LogsFilterField>
      <LogsFilterField className='sm:col-span-2'>
        <LogsFilterInput
          aria-label={t('Search retained text')}
          placeholder={t('Search retained text')}
          value={props.filters.q ?? ''}
          onChange={(event) =>
            props.onChange({ q: event.target.value || undefined })
          }
        />
      </LogsFilterField>
    </>
  )
  const advancedCount = [
    props.filters.username,
    props.filters.model_name,
    props.filters.request_id,
    props.filters.ip,
    props.filters.q,
  ].filter(Boolean).length
  const filterCount =
    advancedCount +
    [props.filters.kind, props.filters.success].filter(Boolean).length
  const hasFilters =
    filterCount > 0 ||
    props.filters.start_timestamp !== undefined ||
    props.filters.end_timestamp !== undefined
  return (
    <LogsFilterToolbar
      table={props.table}
      primaryFilters={
        <>
          {dateFilter}
          {mainFilters}
        </>
      }
      advancedFilters={advancedFilters}
      mobilePinnedFilters={dateFilter}
      mobileFilters={
        <>
          {mainFilters}
          {advancedFilters}
        </>
      }
      mobileFilterCount={filterCount}
      advancedFilterCount={advancedCount}
      hasActiveFilters={hasFilters}
      hasAdvancedActiveFilters={advancedCount > 0}
      searchLoading={props.isFetching}
      onSearch={props.onSearch}
      onReset={props.onReset}
    />
  )
}
