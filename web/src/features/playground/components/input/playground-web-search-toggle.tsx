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
import { useTranslation } from 'react-i18next'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type PlaygroundWebSearchToggleProps = {
  disabled?: boolean
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
}

export function PlaygroundWebSearchToggle(
  props: PlaygroundWebSearchToggleProps
) {
  const { t } = useTranslation()

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <PromptInputButton
            aria-label={t('Web search')}
            aria-pressed={props.enabled}
            className={cn(
              'font-medium',
              props.enabled
                ? 'bg-primary/10 text-primary hover:bg-primary/15'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
            )}
            disabled={props.disabled}
            onClick={() => props.onEnabledChange(!props.enabled)}
            variant='ghost'
          />
        }
      >
        <Globe2Icon size={16} />
        <span className='hidden text-xs sm:inline'>{t('Web search')}</span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t('Web search')}</p>
      </TooltipContent>
    </Tooltip>
  )
}
