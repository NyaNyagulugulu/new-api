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
import { BrainIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'

import { REASONING_EFFORT_OPTIONS } from '../../constants'
import type { ReasoningEffort } from '../../types'

type PlaygroundReasoningSelectorProps = {
  value: ReasoningEffort
  onValueChange: (value: ReasoningEffort) => void
  disabled?: boolean
}

export function PlaygroundReasoningSelector(
  props: PlaygroundReasoningSelectorProps
) {
  const { t } = useTranslation()
  const selectedIndex = Math.max(
    0,
    REASONING_EFFORT_OPTIONS.findIndex((option) => option.value === props.value)
  )
  const selectedOption =
    REASONING_EFFORT_OPTIONS[selectedIndex] ?? REASONING_EFFORT_OPTIONS[0]
  const lastIndex = REASONING_EFFORT_OPTIONS.length - 1

  return (
    <Popover>
      <PopoverTrigger
        render={
          <PromptInputButton
            aria-label={t('Reasoning effort')}
            className='text-muted-foreground hover:text-foreground hover:bg-muted/70 gap-1.5 px-2 font-medium'
            disabled={props.disabled}
            variant='ghost'
          />
        }
      >
        <BrainIcon size={16} />
        <span className='max-w-16 truncate text-xs'>
          {t(selectedOption.labelKey)}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-80 max-w-[calc(100vw-2rem)] gap-3 p-3'
        side='top'
        sideOffset={8}
      >
        <div className='flex items-center justify-between gap-3 px-1'>
          <span className='text-sm font-semibold'>{t('Reasoning effort')}</span>
          <span className='text-muted-foreground text-xs'>
            {t(selectedOption.labelKey)}
          </span>
        </div>
        <div className='px-1.5 pt-1'>
          <Slider
            aria-label={t('Reasoning effort')}
            disabled={props.disabled}
            max={lastIndex}
            min={0}
            onValueChange={(nextValue) => {
              const index = Array.isArray(nextValue) ? nextValue[0] : nextValue
              const option = REASONING_EFFORT_OPTIONS[index]
              if (option) {
                props.onValueChange(option.value)
              }
            }}
            step={1}
            value={[selectedIndex]}
          />
          <div className='text-muted-foreground mt-2 flex justify-between text-[10px]'>
            <span>{t(REASONING_EFFORT_OPTIONS[0].labelKey)}</span>
            <span>{t(REASONING_EFFORT_OPTIONS[lastIndex].labelKey)}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
