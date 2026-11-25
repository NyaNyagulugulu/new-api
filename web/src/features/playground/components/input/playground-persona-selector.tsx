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
import { UserRoundIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { UserPersona } from '../../types'

type PlaygroundPersonaSelectorProps = {
  disabled?: boolean
  personas: UserPersona[]
  value: number
  onValueChange: (personaId: number) => void
}

export function PlaygroundPersonaSelector(
  props: PlaygroundPersonaSelectorProps
) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected =
    props.personas.find((persona) => persona.id === props.value) ??
    props.personas[0]
  const selectedLabel =
    selected?.id === 0 || !selected ? t('Default persona') : selected.name

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <PromptInputButton
            aria-label={t('Persona')}
            className='text-muted-foreground hover:text-foreground hover:bg-muted/70 gap-1.5 px-2 font-medium'
            disabled={props.disabled}
            variant='ghost'
          />
        }
      >
        <UserRoundIcon size={16} />
        <span className='max-w-20 truncate text-xs'>{selectedLabel}</span>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-72 max-w-[calc(100vw-2rem)] gap-2 p-2'
        side='top'
        sideOffset={8}
      >
        <div className='px-2 py-1.5 text-sm font-semibold'>{t('Persona')}</div>
        <div className='grid gap-1'>
          {props.personas.map((persona) => {
            const label = persona.id === 0 ? t('Default persona') : persona.name
            return (
              <button
                aria-pressed={persona.id === props.value}
                className={cn(
                  'hover:bg-muted flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                  persona.id === props.value && 'bg-muted'
                )}
                key={persona.id}
                onClick={() => {
                  props.onValueChange(persona.id)
                  setOpen(false)
                }}
                type='button'
              >
                <UserRoundIcon className='text-muted-foreground size-4 shrink-0' />
                <span className='min-w-0 flex-1 truncate'>{label}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
