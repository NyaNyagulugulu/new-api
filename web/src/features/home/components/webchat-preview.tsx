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
import {
  ArrowUpIcon,
  BrainIcon,
  FileTextIcon,
  MessageSquareIcon,
  PaperclipIcon,
  PlusIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

type WebChatPreviewProps = {
  className?: string
}

export function WebChatPreview(props: WebChatPreviewProps) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'bg-background relative overflow-hidden rounded-2xl border shadow-[0_35px_90px_-50px_rgba(0,0,0,0.5)]',
        props.className
      )}
    >
      <div className='bg-muted/30 flex h-9 items-center gap-1.5 border-b px-3'>
        <span className='bg-destructive/60 size-2 rounded-full' />
        <span className='bg-chart-4/70 size-2 rounded-full' />
        <span className='bg-chart-2/70 size-2 rounded-full' />
        <span className='text-muted-foreground ml-2 text-[10px]'>
          {t('Web chat')}
        </span>
      </div>

      <div className='grid min-h-[360px] grid-cols-[112px_minmax(0,1fr)] max-sm:grid-cols-1'>
        <aside className='bg-muted/15 hidden flex-col border-r p-2 sm:flex'>
          <div className='bg-background mb-2 flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] font-medium'>
            <PlusIcon className='size-3' />
            {t('New chat')}
          </div>
          <div className='space-y-1'>
            {['Design onboarding', 'Database indexes', 'Launch checklist'].map(
              (title, index) => (
                <div
                  className={cn(
                    'truncate rounded-md px-2 py-1.5 text-[10px]',
                    index === 0
                      ? 'bg-background shadow-xs'
                      : 'text-muted-foreground'
                  )}
                  key={title}
                >
                  {title}
                </div>
              )
            )}
          </div>
        </aside>

        <div className='flex min-w-0 flex-col'>
          <div className='flex h-9 items-center gap-2 border-b px-3 text-xs font-medium'>
            <MessageSquareIcon className='text-muted-foreground size-3.5' />
            <span className='truncate'>{t('Design onboarding')}</span>
          </div>

          <div className='flex-1 space-y-4 px-4 py-4'>
            <div className='bg-muted/60 ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md border px-3 py-2 text-[11px] leading-5'>
              {t('Summarize this design and list the next steps.')}
            </div>

            <div className='bg-background flex items-center gap-2 rounded-xl border px-2.5 py-2 text-[10px] shadow-xs'>
              <span className='bg-primary/10 text-primary flex size-7 items-center justify-center rounded-lg'>
                <FileTextIcon className='size-3.5' />
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block truncate font-medium'>
                  wireframe-notes.pdf
                </span>
                <span className='text-muted-foreground'>PDF · 248 KB</span>
              </span>
            </div>

            <div className='space-y-2 text-[11px] leading-5'>
              <p>
                {t(
                  'Keep the first screen focused on one primary action, then reveal advanced controls after the user succeeds.'
                )}
              </p>
              <p className='text-muted-foreground'>
                1. Confirm the outcome · 2. Create a key · 3. Send a test
                request
              </p>
            </div>

            <div className='border-border/60 text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-[9px]'>
              <span>Input 1,284</span>
              <span>Output 486</span>
              <span className='inline-flex items-center gap-1'>
                <BrainIcon className='size-2.5' /> High
              </span>
              <span className='text-foreground/70 font-medium'>¥0.004</span>
            </div>
          </div>

          <div className='p-3 pt-0'>
            <div className='bg-background flex items-center gap-2 rounded-2xl border px-3 py-2.5 shadow-sm'>
              <PaperclipIcon className='text-muted-foreground size-3.5' />
              <span className='text-muted-foreground min-w-0 flex-1 truncate text-[10px]'>
                {t('Ask anything')}
              </span>
              <span className='bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-full'>
                <ArrowUpIcon className='size-3' />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
