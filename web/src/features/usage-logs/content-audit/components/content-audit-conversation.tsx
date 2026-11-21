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
import { AlertCircle, ChevronDown, Paperclip } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent } from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { Response } from '@/components/ai-elements/response'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { getContentAuditContent, type ContentAuditLog } from '../api'
import {
  isPreviewableAudioContentType,
  isPreviewableImageContentType,
  isPreviewableTextContentType,
} from '../lib/content-audit'
import {
  buildContentAuditConversation,
  type AuditConversationMessage,
  type AuditMedia,
} from '../lib/conversation'

type LoadedBundle = {
  requestText: string
  responseText: string
  websocketText: string
  responseBlob?: Blob
}

const ROLE_LABELS: Record<AuditConversationMessage['role'], string> = {
  system: 'System',
  developer: 'Developer',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool',
  event: 'Event',
  error: 'Error',
}

function messageUiRole(
  message: AuditConversationMessage
): 'user' | 'assistant' {
  return message.role === 'user' ? 'user' : 'assistant'
}

function base64MediaUrl(media: AuditMedia): string {
  return `data:${media.mimeType || 'application/octet-stream'};base64,${media.base64}`
}

function MediaContent(props: { media: AuditMedia; compact?: boolean }) {
  const { t } = useTranslation()
  const source = props.media.base64
    ? base64MediaUrl(props.media)
    : props.media.url
  if (!source) return null
  if (props.media.kind === 'image') {
    return (
      <a
        href={source}
        target='_blank'
        rel='noreferrer'
        className='block max-w-xl overflow-hidden rounded-xl border'
      >
        <img
          src={source}
          alt={props.media.name || t('Retained image content')}
          className='max-h-[42dvh] w-auto max-w-full object-contain'
          loading='lazy'
        />
      </a>
    )
  }
  if (props.media.kind === 'audio') {
    return (
      <div className='max-w-xl rounded-xl border p-2'>
        <audio controls src={source} className='w-full'>
          {t('Audio preview is not supported by this browser.')}
        </audio>
      </div>
    )
  }
  if (props.media.kind === 'video') {
    return (
      <video
        controls
        src={source}
        className='max-h-[42dvh] max-w-xl rounded-xl border'
      >
        {t('Video preview is not supported by this browser.')}
      </video>
    )
  }
  return (
    <a
      href={source}
      target='_blank'
      rel='noreferrer'
      className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-4'
    >
      <Paperclip className='size-3.5' />
      {props.media.name || t('Attachment')}
    </a>
  )
}

function ToolCallCard(props: { message: AuditConversationMessage }) {
  return (
    <div className='space-y-2'>
      {props.message.tools.map((tool) => {
        let input: unknown = tool.arguments
        if (tool.arguments) {
          try {
            input = JSON.parse(tool.arguments)
          } catch {
            input = tool.arguments
          }
        }
        return (
          <Tool
            key={
              tool.id ||
              `${tool.name}:${tool.arguments || ''}:${tool.output || ''}`
            }
            defaultOpen={false}
            className='mb-0'
          >
            <ToolHeader
              title={tool.name}
              type={`tool-${tool.name}`}
              state={tool.output ? 'output-available' : 'input-available'}
            />
            <ToolContent>
              <ToolInput input={input as never} />
              <ToolOutput
                output={tool.output || ''}
                errorText=''
                className='pt-0'
              />
            </ToolContent>
          </Tool>
        )
      })}
    </div>
  )
}

function ConversationMessageView(props: { message: AuditConversationMessage }) {
  const { t } = useTranslation()
  const message = props.message
  const isUser = message.role === 'user'
  const isNarrowRole =
    message.role === 'system' ||
    message.role === 'developer' ||
    message.role === 'tool' ||
    message.role === 'event'
  if (message.role === 'error') {
    return (
      <Alert variant='destructive'>
        <AlertCircle />
        <AlertDescription>
          <p className='font-medium'>{t('Request failed')}</p>
          <p className='mt-1 break-words whitespace-pre-wrap'>{message.text}</p>
        </AlertDescription>
      </Alert>
    )
  }
  const content = (
    <div className={cn('min-w-0 space-y-3', isUser && 'w-fit max-w-[72ch]')}>
      {message.reasoning && (
        <Reasoning defaultOpen={false} isStreaming={false}>
          <ReasoningTrigger>{t('Reasoning')}</ReasoningTrigger>
          <ReasoningContent>{message.reasoning}</ReasoningContent>
        </Reasoning>
      )}
      {message.text && (
        <MessageContent
          variant='flat'
          className={cn(
            'max-w-none',
            isUser &&
              'rounded-2xl rounded-br-md border border-border/70 bg-muted/70 px-4 py-2.5 text-foreground shadow-sm shadow-black/5',
            !isUser && 'w-full px-0 py-0'
          )}
        >
          <Response final>{message.text}</Response>
        </MessageContent>
      )}
      {message.tools.length > 0 && <ToolCallCard message={message} />}
      {message.media.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {message.media.map((media) => (
            <MediaContent
              key={`${media.kind}:${media.name || media.mimeType || ''}:${(
                media.url ||
                media.base64 ||
                ''
              ).slice(0, 48)}`}
              media={media}
            />
          ))}
        </div>
      )}
      {message.raw && (
        <CodeBlock
          code={message.raw}
          language='json'
          collapsedLines={18}
          defaultCollapsed
          showToolbar
          title={t('Raw response')}
        >
          <CodeBlockCopyButton />
        </CodeBlock>
      )}
    </div>
  )
  if (isNarrowRole) {
    return (
      <Collapsible
        className='group bg-muted/20 rounded-xl border'
        defaultOpen={false}
      >
        <CollapsibleTrigger className='flex w-full items-center justify-between gap-3 px-3 py-2 text-left'>
          <span className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
            {t(ROLE_LABELS[message.role])}
            {message.name ? ` · ${message.name}` : ''}
          </span>
          <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
        </CollapsibleTrigger>
        <CollapsibleContent className='px-3 pb-3'>{content}</CollapsibleContent>
      </Collapsible>
    )
  }
  return (
    <Message
      className='group flex-row-reverse py-2'
      from={messageUiRole(message)}
    >
      <div className='w-full min-w-0 flex-1 basis-full'>
        <div className='mb-1 text-xs font-medium'>
          {isUser ? t('User') : t('Assistant')}
          {message.name ? ` · ${message.name}` : ''}
        </div>
        {content}
      </div>
    </Message>
  )
}

function rawFallback(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function LoadedConversation(props: {
  entry: ContentAuditLog
  bundle: LoadedBundle
  requestPreview: string
  responsePreview: string
}) {
  const { t } = useTranslation()
  const [binaryUrl, setBinaryUrl] = useState('')
  const [visibleCount, setVisibleCount] = useState(80)
  const conversation = useMemo(
    () =>
      buildContentAuditConversation({
        kind: props.entry.kind,
        requestText: props.bundle.requestText,
        requestPreview: props.entry.has_request ? props.requestPreview : '',
        requestContentType: props.entry.request_content_type,
        responseText: props.bundle.responseText,
        responsePreview: props.entry.has_response ? props.responsePreview : '',
        responseContentType: props.entry.response_content_type,
        websocketText: props.bundle.websocketText,
      }),
    [props.bundle, props.entry, props.requestPreview, props.responsePreview]
  )
  const responseBlob = props.bundle.responseBlob
  const binaryResponse =
    responseBlob &&
    !isPreviewableTextContentType(props.entry.response_content_type)
      ? responseBlob
      : undefined
  useEffect(() => {
    if (!binaryResponse) {
      setBinaryUrl('')
      return undefined
    }
    const url = URL.createObjectURL(binaryResponse)
    setBinaryUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [binaryResponse])

  let media: AuditMedia | undefined
  if (binaryUrl) {
    if (isPreviewableImageContentType(props.entry.response_content_type)) {
      media = {
        kind: 'image',
        url: binaryUrl,
        mimeType: props.entry.response_content_type,
      }
    } else if (
      isPreviewableAudioContentType(props.entry.response_content_type)
    ) {
      media = {
        kind: 'audio',
        url: binaryUrl,
        mimeType: props.entry.response_content_type,
      }
    } else if (
      props.entry.response_content_type.toLowerCase().startsWith('video/')
    ) {
      media = {
        kind: 'video',
        url: binaryUrl,
        mimeType: props.entry.response_content_type,
      }
    }
  }
  const messages = conversation.messages.map((message) => ({
    ...message,
    media: [...message.media],
  }))
  if (media && messages.length === 0) {
    messages.push({
      id: 'binary-response',
      role: 'assistant',
      text: '',
      tools: [],
      media: [media],
    })
  }
  if (messages.length === 0) {
    const fallback = props.bundle.responseText || props.bundle.requestText
    if (!fallback && !media) {
      return (
        <p className='text-muted-foreground p-6 text-sm'>
          {t('No readable conversation content is available.')}
        </p>
      )
    }
    if (fallback) {
      return (
        <div className='min-h-0 overflow-y-auto p-4'>
          <CodeBlock
            code={rawFallback(fallback)}
            language='json'
            collapsedLines={30}
            showToolbar
            title={t('Raw content')}
          >
            <CodeBlockCopyButton />
          </CodeBlock>
        </div>
      )
    }
  }
  if (media && messages.length > 0) {
    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant')
    if (lastAssistant) {
      lastAssistant.media = [...lastAssistant.media, media]
    } else {
      messages.push({
        id: 'binary-response',
        role: 'assistant',
        text: '',
        tools: [],
        media: [media],
      })
    }
  }
  const hiddenCount = Math.max(0, messages.length - visibleCount)
  const visibleMessages =
    hiddenCount > 0 ? messages.slice(-visibleCount) : messages
  return (
    <Conversation className='h-[58dvh]'>
      <ConversationContent className='space-y-3 p-4'>
        {hiddenCount > 0 && (
          <div className='flex justify-center pb-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => setVisibleCount((count) => count + 120)}
            >
              {t('Show {{count}} earlier messages', { count: hiddenCount })}
            </Button>
          </div>
        )}
        {visibleMessages.map((message) => (
          <ConversationMessageView key={message.id} message={message} />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}

export function ContentAuditConversation(props: {
  entry: ContentAuditLog
  enabled: boolean
  requestPreview: string
  responsePreview: string
}) {
  const { t } = useTranslation()
  const [bundle, setBundle] = useState<LoadedBundle | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!props.enabled || bundle) return
    let active = true
    setLoading(true)
    setError(false)
    void Promise.all([
      props.entry.has_request
        ? getContentAuditContent(props.entry.event_id, 'request')
        : Promise.resolve(undefined),
      props.entry.has_response
        ? getContentAuditContent(props.entry.event_id, 'response')
        : Promise.resolve(undefined),
      props.entry.has_websocket
        ? getContentAuditContent(props.entry.event_id, 'websocket')
        : Promise.resolve(undefined),
    ])
      .then(async ([requestBlob, responseBlob, websocketBlob]) => {
        if (!active) return
        const requestText = await blobText(
          requestBlob,
          props.entry.request_content_type
        )
        const responseText = await blobText(
          responseBlob,
          props.entry.response_content_type
        )
        const websocketText = websocketBlob ? await websocketBlob.text() : ''
        if (!active) return
        setBundle({
          requestText:
            requestText ||
            (props.entry.has_request ? props.requestPreview : ''),
          responseText:
            responseText ||
            (props.entry.has_response ? props.responsePreview : ''),
          websocketText,
          responseBlob,
        })
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [
    bundle,
    props.enabled,
    props.entry.event_id,
    props.entry.has_request,
    props.entry.has_response,
    props.entry.has_websocket,
    props.entry.request_content_type,
    props.entry.response_content_type,
    props.requestPreview,
    props.responsePreview,
  ])

  if (loading) {
    return (
      <div className='space-y-3 p-4'>
        <Skeleton className='h-20 w-3/4' />
        <Skeleton className='ml-auto h-14 w-1/2' />
        <Skeleton className='h-28 w-full' />
      </div>
    )
  }
  if (error) {
    return (
      <Alert variant='destructive' className='m-4'>
        <AlertDescription>
          {t('Failed to load retained content')}
        </AlertDescription>
      </Alert>
    )
  }
  if (!bundle) {
    return <p className='text-muted-foreground p-6 text-sm'>{t('Loading')}</p>
  }
  return (
    <LoadedConversation
      entry={props.entry}
      bundle={bundle}
      requestPreview={props.requestPreview}
      responsePreview={props.responsePreview}
    />
  )
}

async function blobText(blob: Blob | undefined, contentType: string) {
  if (!blob || !isPreviewableTextContentType(contentType)) return ''
  return blob.text()
}
