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

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
  const selectedOption =
    REASONING_EFFORT_OPTIONS.find((option) => option.value === props.value) ??
    REASONING_EFFORT_OPTIONS[0]

  return (
    <Select
      disabled={props.disabled}
      onValueChange={(value) => {
        if (value === null || value === 'auto') {
          props.onValueChange('')
          return
        }
        props.onValueChange(value as ReasoningEffort)
      }}
      value={props.value || 'auto'}
    >
      <SelectTrigger
        aria-label={t('Reasoning effort')}
        className='bg-background/80 h-8 max-w-32 rounded-lg px-2 text-xs'
        size='sm'
      >
        <BrainIcon className='text-muted-foreground' />
        <SelectValue>{t(selectedOption.labelKey)}</SelectValue>
      </SelectTrigger>
      <SelectContent align='start' side='top' sideOffset={6}>
        <SelectGroup>
          <SelectLabel>{t('Reasoning effort')}</SelectLabel>
          {REASONING_EFFORT_OPTIONS.map((option) => (
            <SelectItem
              key={option.value || 'auto'}
              value={option.value || 'auto'}
            >
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
