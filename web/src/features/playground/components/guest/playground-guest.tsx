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
import { Link } from '@tanstack/react-router'
import {
  ArrowRightIcon,
  BrainIcon,
  FileImageIcon,
  GaugeIcon,
  SparklesIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'

const FEATURES = [
  { icon: FileImageIcon, labelKey: 'Images & files' },
  { icon: BrainIcon, labelKey: 'Reasoning levels' },
  { icon: GaugeIcon, labelKey: 'Token usage & cost' },
]

export function PlaygroundGuest() {
  const { t } = useTranslation()

  return (
    <PublicLayout showMainContainer={false}>
      <main className='flex min-h-svh flex-col pt-16'>
        <div className='flex flex-1 items-center justify-center px-6 py-16'>
          <div className='grid w-full max-w-xl justify-items-center gap-7 text-center'>
            <div className='bg-muted/40 flex size-14 items-center justify-center rounded-2xl border shadow-xs'>
              <SparklesIcon className='size-6' aria-hidden='true' />
            </div>

            <div className='grid gap-3'>
              <h1 className='text-3xl font-semibold tracking-tight text-balance md:text-4xl'>
                {t('A clean web chat for every model')}
              </h1>
              <p className='text-muted-foreground mx-auto max-w-lg text-sm leading-6 text-balance md:text-base md:leading-7'>
                {t(
                  'Chat naturally with any available model, attach images and files, choose reasoning effort, and review token usage and cost after every reply.'
                )}
              </p>
            </div>

            <div className='flex flex-wrap items-center justify-center gap-2'>
              {FEATURES.map(({ icon: Icon, labelKey }) => (
                <span
                  className='bg-background text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs'
                  key={labelKey}
                >
                  <Icon className='size-3.5' aria-hidden='true' />
                  {t(labelKey)}
                </span>
              ))}
            </div>

            <div className='flex flex-wrap items-center justify-center gap-3'>
              <Button
                className='group rounded-lg'
                render={
                  <Link search={{ redirect: '/playground' }} to='/sign-in' />
                }
              >
                {t('Sign in to start chatting')}
                <ArrowRightIcon className='transition-transform duration-200 group-hover:translate-x-0.5' />
              </Button>
              <Button
                className='rounded-lg'
                render={<Link to='/pricing' />}
                variant='outline'
              >
                {t('Explore models')}
              </Button>
            </div>
          </div>
        </div>

        <div className='mx-auto w-full max-w-3xl px-4 pb-8 sm:px-6'>
          <Button
            className='bg-background/95 text-muted-foreground h-auto w-full justify-start rounded-[26px] border px-5 py-5 text-left shadow-lg'
            render={<Link search={{ redirect: '/playground' }} to='/sign-in' />}
            variant='outline'
          >
            <span className='min-w-0 flex-1'>
              {t('Sign in to ask anything')}
            </span>
            <span className='bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full'>
              <ArrowRightIcon className='size-4' />
            </span>
          </Button>
          <p className='text-muted-foreground mt-3 text-center text-[11px]'>
            {t('AI can make mistakes. Check important information.')}
          </p>
        </div>
      </main>
    </PublicLayout>
  )
}
