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
import { DownloadIcon, FileIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button, buttonVariants } from '@/components/ui/button'

import type { MessageAttachment } from '../../types'

type MessageAttachmentsProps = {
  attachments: MessageAttachment[]
}

export function MessageAttachments(props: MessageAttachmentsProps) {
  const { t } = useTranslation()
  const [previewAttachment, setPreviewAttachment] =
    useState<MessageAttachment | null>(null)

  if (props.attachments.length === 0) return null

  return (
    <>
      <div className='flex max-w-full flex-wrap gap-2'>
        {props.attachments.map((attachment) =>
          attachment.kind === 'image' ? (
            <Button
              aria-label={`${t('Preview image')}: ${attachment.name}`}
              className='bg-muted size-28 overflow-hidden rounded-xl border p-0 shadow-sm'
              key={attachment.id}
              onClick={() => setPreviewAttachment(attachment)}
              type='button'
              variant='outline'
            >
              <img
                alt={attachment.name}
                className='size-full object-cover'
                loading='lazy'
                src={attachment.dataUrl}
              />
            </Button>
          ) : (
            <a
              aria-label={`${t('Download')}: ${attachment.name}`}
              className={buttonVariants({
                className: 'h-auto max-w-64 justify-start rounded-xl px-3 py-2',
                variant: 'outline',
              })}
              download={attachment.name}
              href={attachment.dataUrl}
              key={attachment.id}
              rel='noreferrer'
              target='_blank'
            >
              <FileIcon />
              <span className='min-w-0'>
                <span className='block truncate text-xs font-medium'>
                  {attachment.name}
                </span>
                <span className='text-muted-foreground block truncate text-[10px]'>
                  {attachment.mediaType}
                </span>
              </span>
            </a>
          )
        )}
      </div>

      <Dialog
        footer={
          previewAttachment ? (
            <a
              className={buttonVariants({ variant: 'outline' })}
              download={previewAttachment.name}
              href={previewAttachment.dataUrl}
            >
              <DownloadIcon />
              {t('Download')}
            </a>
          ) : undefined
        }
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null)
        }}
        open={Boolean(previewAttachment)}
        title={previewAttachment?.name}
      >
        {previewAttachment ? (
          <div className='bg-muted/20 flex max-h-[70vh] items-center justify-center overflow-hidden rounded-xl border'>
            <img
              alt={previewAttachment.name}
              className='max-h-[70vh] max-w-full object-contain'
              src={previewAttachment.dataUrl}
            />
          </div>
        ) : null}
      </Dialog>
    </>
  )
}
