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
  SparklesIcon,
  BarChartIcon,
  CodeSquareIcon,
  GraduationCapIcon,
  NotepadTextIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

type PlaygroundEmptyStateProps = {
  onSelectPrompt: (prompt: string) => void
}

const starterPrompts = [
  { icon: BarChartIcon, text: 'Analyze data' },
  { icon: NotepadTextIcon, text: 'Summarize text' },
  { icon: CodeSquareIcon, text: 'Code' },
  { icon: GraduationCapIcon, text: 'Get advice' },
]

export function PlaygroundEmptyState({
  onSelectPrompt,
}: PlaygroundEmptyStateProps) {
  const { t } = useTranslation()

  return (
    <div className='flex min-h-[min(520px,calc(100svh-18rem))] items-center justify-center px-1 py-12'>
      <div className='grid w-full max-w-xl gap-7 text-center'>
        <div className='bg-muted/30 mx-auto flex size-12 items-center justify-center rounded-2xl border shadow-xs'>
          <SparklesIcon className='size-5' aria-hidden='true' />
        </div>

        <div className='grid gap-2.5'>
          <h2 className='text-2xl font-semibold tracking-tight text-balance md:text-3xl'>
            {t('What can I help with?')}
          </h2>
          <p className='text-muted-foreground mx-auto max-w-md text-sm leading-6 text-balance'>
            {t('Ask anything, explore ideas, or build something.')}
          </p>
        </div>

        <div className='grid gap-2 text-left sm:grid-cols-2'>
          {starterPrompts.map(({ icon: Icon, text }) => {
            const prompt = t(text)

            return (
              <Button
                className='bg-background h-auto min-h-12 justify-start gap-2.5 rounded-xl px-3.5 py-3 text-left whitespace-normal'
                key={text}
                onClick={() => onSelectPrompt(prompt)}
                variant='outline'
              >
                <Icon className='text-muted-foreground size-4' />
                <span className='text-sm'>{prompt}</span>
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
