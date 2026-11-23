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
import { Globe2Icon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import deepSeekThinkingImage from '@/assets/custom/deep.gif'
import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Loader } from '@/components/ai-elements/loader'
import { MessageContent } from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { Response } from '@/components/ai-elements/response'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { MESSAGE_STATUS } from '../../constants'
import {
  getCurrentVersion,
  getMessageAlignmentClass,
  getMessageContentState,
  isErrorMessage,
  type MessageAlignment,
} from '../../lib'
import { getMessageContentStyles } from '../../lib/message/message-styles'
import type { Message, WebSearchStatus } from '../../types'
import { MessageAttachments } from './message-attachments'
import { MessageError } from './message-error'
import { MessageMetadata } from './message-metadata'

const DEEPSEEK_MODEL_PATTERN = /deepseek/i

function getWebSearchLabelKey(status: Exclude<WebSearchStatus, 'searching'>) {
  switch (status) {
    case 'used':
      return 'Searched the web'
    case 'empty':
      return 'Web search returned no results'
    case 'failed':
      return 'Web search failed'
    case 'skipped':
      return 'Web search skipped'
  }
}

function getWebSearchBadgeVariant(
  status: Exclude<WebSearchStatus, 'searching'>
) {
  if (status === 'failed') return 'warning' as const
  if (status === 'empty') return 'outline' as const
  return 'secondary' as const
}

type PlaygroundMessageContentProps = {
  actions: ReactNode
  alignment: MessageAlignment
  errorActions?: ReactNode
  isSourceVisible?: boolean
  message: Message
  versionContent: string
}

export function PlaygroundMessageContent({
  actions,
  alignment,
  errorActions,
  isSourceVisible = false,
  message,
  versionContent,
}: PlaygroundMessageContentProps) {
  const { t } = useTranslation()
  const {
    displayContent,
    hasReasoning,
    hasSources,
    reasoningContent,
    showLoader,
    showMessageContent,
    sources,
  } = getMessageContentState(message, versionContent)
  const isError = isErrorMessage(message)
  const attachments = getCurrentVersion(message).attachments ?? []
  const hasAttachments = attachments.length > 0
  const isMessageFinal =
    message.status !== MESSAGE_STATUS.LOADING &&
    message.status !== MESSAGE_STATUS.STREAMING
  const webSearchStatus = message.webSearch?.status
  const showDeepSeekThinking =
    !isMessageFinal &&
    webSearchStatus !== 'searching' &&
    DEEPSEEK_MODEL_PATTERN.test(message.model ?? '')

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col',
        getMessageAlignmentClass(alignment)
      )}
    >
      {hasSources && (
        <Sources>
          <SourcesTrigger count={sources.length} />
          <SourcesContent>
            {sources.map((source) => (
              <Source
                href={source.href}
                key={`${source.href}-${source.title}`}
                title={source.title}
              />
            ))}
          </SourcesContent>
        </Sources>
      )}

      {webSearchStatus === 'searching' && (
        <div
          aria-live='polite'
          className='text-muted-foreground mb-3 flex items-center gap-2 text-xs'
          role='status'
        >
          <Loader size={14} />
          <Shimmer duration={1}>{t('Searching the web...')}</Shimmer>
        </div>
      )}

      {webSearchStatus && webSearchStatus !== 'searching' && (
        <Badge
          className='mb-3'
          variant={getWebSearchBadgeVariant(webSearchStatus)}
        >
          <Globe2Icon aria-hidden='true' />
          {t(getWebSearchLabelKey(webSearchStatus))}
        </Badge>
      )}

      {showDeepSeekThinking && (
        <div
          aria-live='polite'
          className='flex min-h-16 items-center py-2'
          role='status'
        >
          <img
            alt=''
            aria-hidden='true'
            className='h-20 w-60 max-w-full object-contain object-left'
            data-testid='deepseek-thinking'
            src={deepSeekThinkingImage}
          />
          <span className='sr-only'>{t('Responding...')}</span>
        </div>
      )}

      {hasReasoning && (
        <Reasoning
          defaultOpen
          duration={message.reasoning?.duration}
          isStreaming={message.isReasoningStreaming}
        >
          <ReasoningTrigger />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      )}

      {showLoader &&
        !showDeepSeekThinking &&
        webSearchStatus !== 'searching' && (
          <div
            aria-live='polite'
            className='flex min-h-16 items-center py-2'
            role='status'
          >
            <div className='flex items-center gap-2'>
              <Loader />
              <Shimmer className='text-sm' duration={1}>
                {t('Responding...')}
              </Shimmer>
            </div>
          </div>
        )}

      {isError && (
        <>
          <MessageError message={message} className='mb-2' />
          <MessageMetadata alignment={alignment} message={message} />
          {errorActions}
        </>
      )}

      {!isError && (showMessageContent || hasAttachments) && (
        <>
          {hasAttachments && <MessageAttachments attachments={attachments} />}

          {showMessageContent &&
            (isSourceVisible ? (
              <CodeBlock
                code={versionContent}
                className='my-0 group-[.is-assistant]:w-full group-[.is-assistant]:max-w-[78ch]'
                collapsedLines={24}
                defaultCollapsed={false}
                language='markdown'
                maxExpandedLines={48}
                showLineNumbers
                showToolbar
                title={t('Raw response')}
              >
                <CodeBlockCopyButton />
              </CodeBlock>
            ) : (
              <MessageContent
                variant='flat'
                className={cn(getMessageContentStyles())}
              >
                <Response final={isMessageFinal}>{displayContent}</Response>
              </MessageContent>
            ))}
          <MessageMetadata alignment={alignment} message={message} />
          {actions}
        </>
      )}
    </div>
  )
}
