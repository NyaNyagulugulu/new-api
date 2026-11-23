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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputTextarea,
  usePromptInputAttachments,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'

import {
  createMessageAttachments,
  getSubmittableInputContent,
  getTotalAttachmentBytes,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_FILES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from '../../lib'
import type {
  ModelOption,
  GroupOption,
  ParameterEnabled,
  PlaygroundConfig,
  MessageAttachment,
} from '../../types'
import { PlaygroundInputControls } from './playground-input-controls'
import { PlaygroundParameterPanel } from './playground-parameter-panel'

function PlaygroundInputAttachmentList() {
  const attachments = usePromptInputAttachments()
  if (attachments.files.length === 0) return null

  return (
    <PromptInputHeader className='px-4 pt-3'>
      <PromptInputAttachments>
        {(attachment) => (
          <PromptInputAttachment data={attachment} key={attachment.id} />
        )}
      </PromptInputAttachments>
    </PromptInputHeader>
  )
}

interface PlaygroundInputProps {
  config: PlaygroundConfig
  onSubmit: (text: string, attachments?: MessageAttachment[]) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
  onConfigChange: <K extends keyof PlaygroundConfig>(
    key: K,
    value: PlaygroundConfig[K]
  ) => void
  onParameterEnabledChange: (
    key: keyof ParameterEnabled,
    value: boolean
  ) => void
  parameterEnabled: ParameterEnabled
}

export function PlaygroundInput({
  config,
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  groups,
  groupValue,
  onGroupChange,
  onConfigChange,
  onParameterEnabledChange,
  parameterEnabled,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  const handleSubmit = async (message: PromptInputMessage) => {
    const submittableContent = getSubmittableInputContent(message, disabled)

    if (!submittableContent) return

    const attachments = await createMessageAttachments(submittableContent.files)
    if (getTotalAttachmentBytes(attachments) > MAX_TOTAL_ATTACHMENT_BYTES) {
      toast.error(
        t('Attachments are too large. Reduce the number or size of files.')
      )
      throw new Error('Attachments exceed the total size limit')
    }

    onSubmit(submittableContent.text, attachments)
    setText('')
  }

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <PromptInput
        className='relative'
        groupClassName='bg-background/95 dark:bg-background/80 border-border/70 shadow-[0_18px_60px_-32px_rgba(0,0,0,0.55)] ring-1 ring-foreground/5 rounded-[26px] overflow-hidden transition-all duration-200 focus-within:border-primary/35 focus-within:ring-primary/10 focus-within:shadow-[0_22px_70px_-34px_rgba(0,0,0,0.7)]'
        globalDrop
        maxFiles={MAX_ATTACHMENT_FILES}
        maxFileSize={MAX_ATTACHMENT_FILE_BYTES}
        multiple
        onError={(error) => toast.error(t(error.message))}
        onSubmit={handleSubmit}
      >
        <PlaygroundInputAttachmentList />

        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='min-h-20 px-5 pt-4 pb-3 leading-7 md:min-h-24 md:text-base'
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('Ask anything')}
          value={text}
        />

        <PromptInputFooter className='px-3 pb-2.5'>
          <PlaygroundInputControls
            disabled={disabled}
            groups={groups}
            groupValue={groupValue}
            isGenerating={isGenerating}
            isModelLoading={isModelLoading}
            models={models}
            modelValue={modelValue}
            onGroupChange={onGroupChange}
            onModelChange={onModelChange}
            onStop={onStop}
            text={text}
            tools={
              <PlaygroundParameterPanel
                config={config}
                disabled={disabled}
                onConfigChange={onConfigChange}
                onParameterEnabledChange={onParameterEnabledChange}
                parameterEnabled={parameterEnabled}
              />
            }
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
