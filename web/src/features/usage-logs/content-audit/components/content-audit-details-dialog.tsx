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
import { ChevronDown, Download, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'

import {
  DetailRow,
  DetailSection,
} from '../../components/dialogs/log-detail-layout'
import {
  getContentAuditContent,
  getContentAuditLogDetail,
  type ContentAuditLog,
  type ContentAuditPart,
} from '../api'
import {
  contentAuditKindLabel,
  contentAuditKindVariant,
  downloadBlob,
  formatContentAuditSize,
  isPreviewableAudioContentType,
  isPreviewableImageContentType,
  isPreviewableTextContentType,
} from '../lib/content-audit'
import { ContentAuditConversation } from './content-audit-conversation'

const PART_LABELS: Record<ContentAuditPart, string> = {
  request: 'Request',
  response: 'Response',
  websocket: 'WebSocket',
}

type ContentAuditTab = 'conversation' | ContentAuditPart

export function ContentAuditDetailsDialog(props: { entry: ContentAuditLog }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ContentAuditTab>('conversation')
  const detail = useQuery({
    queryKey: ['content-audit-detail', props.entry.event_id],
    queryFn: () => getContentAuditLogDetail(props.entry.event_id),
    enabled: open,
    retry: false,
  })
  const entry = detail.data ?? props.entry
  const availableParts = useMemo(() => {
    const parts: ContentAuditPart[] = []
    if (entry.has_request) parts.push('request')
    if (entry.has_response) parts.push('response')
    if (entry.has_websocket) parts.push('websocket')
    return parts
  }, [entry.has_request, entry.has_response, entry.has_websocket])
  const availableTabs = useMemo<ContentAuditTab[]>(
    () => (availableParts.length ? ['conversation', ...availableParts] : []),
    [availableParts]
  )

  useEffect(() => {
    if (!open || availableTabs.length === 0) return
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0])
    }
  }, [activeTab, availableTabs, open])

  const previewFor = (part: ContentAuditPart): string => {
    if (!detail.data) return ''
    if (part === 'request') {
      return detail.data.request_text ?? detail.data.request_preview
    }
    if (part === 'response') {
      return detail.data.response_text ?? detail.data.response_preview
    }
    return detail.data.websocket_text ?? ''
  }
  const previewCompleteFor = (part: ContentAuditPart): boolean => {
    if (!detail.data) return false
    if (part === 'request') return detail.data.request_text !== undefined
    if (part === 'response') return detail.data.response_text !== undefined
    if (part === 'websocket') return detail.data.websocket_text !== undefined
    return false
  }
  const contentTypeFor = (part: ContentAuditPart): string => {
    if (part === 'request') return entry.request_content_type
    if (part === 'response') return entry.response_content_type
    return 'application/x-ndjson; charset=utf-8'
  }
  const sizeFor = (part: ContentAuditPart): number => {
    if (part === 'request') return entry.request_size
    if (part === 'response') return entry.response_size
    return entry.websocket_size
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('Retained content')}
      description={t(
        'Request and response content retained for illegal-content traceability. Access to this record is audited.'
      )}
      descriptionClassName='sr-only'
      trigger={
        <Button variant='ghost' size='sm' className='h-7 px-2'>
          {t('Details')}
        </Button>
      }
      contentClassName='min-w-0 sm:max-w-4xl max-sm:max-h-(--dialog-available-height) max-sm:w-[calc(100vw-1.5rem)] max-sm:max-w-[calc(100vw-1.5rem)]'
      titleClassName='text-base'
      contentHeight='min(78dvh, 900px)'
      bodyClassName='space-y-3'
    >
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <StatusBadge
          label={t(contentAuditKindLabel(entry.kind))}
          variant={contentAuditKindVariant(entry.kind)}
          copyable={false}
        />
        <StatusBadge
          label={entry.success ? t('Success') : t('Failed')}
          variant={entry.success ? 'success' : 'danger'}
          copyable={false}
        />
        <span className='text-muted-foreground tabular-nums'>
          {dayjs.unix(entry.created_at).format('YYYY-MM-DD HH:mm:ss')}
        </span>
        <span className='text-muted-foreground font-mono'>
          HTTP {entry.status_code}
        </span>
      </div>

      <div className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
        <span>{entry.username || t('Unknown user')}</span>
        <span className='font-mono'>{entry.model_name || '—'}</span>
        <span className='font-mono'>{entry.channel_name || '—'}</span>
        <span className='font-mono'>#{entry.request_id || entry.event_id}</span>
      </div>

      <Collapsible className='group bg-muted/20 rounded-lg border'>
        <CollapsibleTrigger className='flex w-full items-center justify-between gap-3 px-3 py-2 text-left'>
          <span className='text-xs font-medium'>{t('Metadata')}</span>
          <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
        </CollapsibleTrigger>
        <CollapsibleContent className='px-3 pb-3'>
          <DetailSection label={t('Request')}>
            <DetailRow label={t('User')} value={entry.username || '—'} />
            <DetailRow label={t('User ID')} value={entry.user_id || '—'} mono />
            <DetailRow
              label={t('Model')}
              value={entry.model_name || '—'}
              mono
            />
            <DetailRow
              label={t('Route')}
              value={`${entry.method} ${entry.path}`}
              mono
            />
            <DetailRow
              label={t('Request ID')}
              value={entry.request_id || '—'}
              mono
            />
            <DetailRow label='IP' value={entry.ip || '—'} mono />
            <DetailRow label={t('Channel')} value={entry.channel_name || '—'} />
            <DetailRow label={t('Node')} value={entry.node_name || '—'} mono />
            <DetailRow
              label={t('Retention expires')}
              value={dayjs.unix(entry.expires_at).format('YYYY-MM-DD HH:mm:ss')}
            />
          </DetailSection>
        </CollapsibleContent>
      </Collapsible>

      {detail.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Failed to load content audit record')}
          </AlertDescription>
        </Alert>
      )}

      {availableTabs.length > 0 ? (
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as ContentAuditTab)}
          className='min-h-0'
        >
          <TabsList aria-label={t('Retained content')}>
            {availableTabs.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {tab === 'conversation'
                  ? t('Conversation')
                  : t(PART_LABELS[tab])}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value='conversation' className='min-h-0'>
            <ContentAuditConversation
              entry={entry}
              enabled={open && activeTab === 'conversation' && detail.isSuccess}
              requestText={detail.data?.request_text}
              responseText={detail.data?.response_text}
              websocketText={detail.data?.websocket_text}
              requestPreview={previewFor('request')}
              responsePreview={previewFor('response')}
            />
          </TabsContent>
          {availableParts.map((part) => (
            <TabsContent key={part} value={part} className='min-h-0'>
              <ContentAuditPartPreview
                entry={entry}
                part={part}
                preview={previewFor(part)}
                previewComplete={previewCompleteFor(part)}
                contentType={contentTypeFor(part)}
                size={sizeFor(part)}
                enabled={open && activeTab === part}
              />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <p className='text-muted-foreground text-sm'>
          {t('No retained content is available for this request.')}
        </p>
      )}
    </Dialog>
  )
}

function ContentAuditPartPreview(props: {
  entry: ContentAuditLog
  part: ContentAuditPart
  preview: string
  previewComplete: boolean
  contentType: string
  size: number
  enabled: boolean
}) {
  const { t } = useTranslation()
  const [loadFull, setLoadFull] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const autoLoad =
    !props.preview &&
    !props.previewComplete &&
    (isPreviewableImageContentType(props.contentType) ||
      isPreviewableAudioContentType(props.contentType))
  const payload = useQuery({
    queryKey: ['content-audit-content', props.entry.event_id, props.part],
    queryFn: () => getContentAuditContent(props.entry.event_id, props.part),
    enabled: props.enabled && !props.previewComplete && (loadFull || autoLoad),
    retry: false,
  })
  const handleDownload = async () => {
    setDownloading(true)
    try {
      if (props.previewComplete && props.preview) {
        downloadBlob(
          new Blob([props.preview], { type: props.contentType }),
          `${props.entry.event_id}-${props.part}.bin`
        )
        return
      }
      const blob =
        payload.data ??
        (await getContentAuditContent(props.entry.event_id, props.part))
      downloadBlob(blob, `${props.entry.event_id}-${props.part}.bin`)
    } catch (error) {
      handleServerError(error, t('Failed to download content'))
    } finally {
      setDownloading(false)
    }
  }
  let content: ReactNode = null
  if (!loadFull && props.preview) {
    content = (
      <pre className='bg-muted/40 max-h-[42dvh] overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap'>
        {props.preview}
      </pre>
    )
  } else if (payload.data) {
    content = (
      <LoadedContent
        blob={payload.data}
        contentType={props.contentType}
        filename={`${props.entry.event_id}-${props.part}.bin`}
      />
    )
  } else if (!payload.isFetching && !autoLoad) {
    content = (
      <p className='text-muted-foreground text-sm'>
        {t('Load or download this content to inspect the full payload.')}
      </p>
    )
  }

  return (
    <div className='min-w-0 space-y-2'>
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <span className='text-muted-foreground font-mono'>
          {props.contentType || t('Unknown content type')}
        </span>
        <span className='text-muted-foreground tabular-nums'>
          {formatContentAuditSize(props.size)}
        </span>
        {props.preview && !props.previewComplete && (
          <span className='text-muted-foreground'>
            {t('Preview is limited to the first 8 KB')}
          </span>
        )}
        <span className='ml-auto flex gap-1'>
          {!!props.preview && !props.previewComplete && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={() => setLoadFull(true)}
              disabled={loadFull || payload.isFetching}
            >
              {payload.isFetching && <Loader2 className='animate-spin' />}
              {t('Load full content')}
            </Button>
          )}
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7 px-2 text-xs'
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            {downloading ? <Loader2 className='animate-spin' /> : <Download />}
            {t('Download')}
          </Button>
        </span>
      </div>
      {payload.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Failed to load retained content')}
          </AlertDescription>
        </Alert>
      )}
      {payload.isFetching && (
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <Loader2 className='animate-spin' />
          {t('Loading')}
        </div>
      )}
      {content}
    </div>
  )
}

function LoadedContent(props: {
  blob: Blob
  contentType: string
  filename: string
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [objectUrl, setObjectUrl] = useState('')
  const isText =
    props.blob.type.startsWith('text/') ||
    isPreviewableTextContentType(props.contentType) ||
    isPreviewableTextContentType(props.blob.type)
  const isImage =
    props.blob.type.startsWith('image/') ||
    isPreviewableImageContentType(props.contentType)
  const isAudio =
    props.blob.type.startsWith('audio/') ||
    isPreviewableAudioContentType(props.contentType)

  useEffect(() => {
    if (isText) {
      let active = true
      void props.blob.text().then((value) => {
        if (active) setText(value)
      })
      return () => {
        active = false
      }
    }
    if (isImage || isAudio) {
      const url = URL.createObjectURL(props.blob)
      setObjectUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    return undefined
  }, [isAudio, isImage, isText, props.blob])

  if (isImage && objectUrl) {
    return (
      <div className='bg-muted/30 flex max-h-[42dvh] justify-center overflow-auto rounded-md border p-3'>
        <img
          src={objectUrl}
          alt={t('Retained image content')}
          className='max-h-[38dvh] max-w-full object-contain'
        />
      </div>
    )
  }
  if (isAudio && objectUrl) {
    return (
      <audio controls src={objectUrl} className='w-full'>
        {t('Audio preview is not supported by this browser.')}
      </audio>
    )
  }
  if (isText) {
    return (
      <pre className='bg-muted/40 max-h-[42dvh] overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap'>
        {text}
      </pre>
    )
  }
  return (
    <p className='text-muted-foreground text-sm'>
      {t('Binary content cannot be previewed. Download it to inspect.')}
    </p>
  )
}
