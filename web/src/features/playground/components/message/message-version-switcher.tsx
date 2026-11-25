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
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { getCurrentVersion } from '../../lib'
import type { Message } from '../../types'

type MessageVersionSwitcherProps = {
  disabled?: boolean
  message: Message
  onSwitchVersion: (message: Message, versionId: string) => void
}

export function MessageVersionSwitcher(props: MessageVersionSwitcherProps) {
  const { t } = useTranslation()
  if (props.message.versions.length < 2) return null

  const currentVersion = getCurrentVersion(props.message)
  const currentIndex = Math.max(
    0,
    props.message.versions.findIndex(
      (version) => version.id === currentVersion.id
    )
  )
  const previousVersion = props.message.versions[currentIndex - 1]
  const nextVersion = props.message.versions[currentIndex + 1]

  return (
    <div className='text-muted-foreground flex items-center gap-0.5 text-xs'>
      <Button
        aria-label={t('Previous')}
        disabled={props.disabled || !previousVersion}
        onClick={() =>
          previousVersion &&
          props.onSwitchVersion(props.message, previousVersion.id)
        }
        size='icon-sm'
        type='button'
        variant='ghost'
      >
        <ChevronLeftIcon className='size-3.5' />
      </Button>
      <span className='min-w-8 text-center tabular-nums'>
        {currentIndex + 1} / {props.message.versions.length}
      </span>
      <Button
        aria-label={t('Next')}
        disabled={props.disabled || !nextVersion}
        onClick={() =>
          nextVersion && props.onSwitchVersion(props.message, nextVersion.id)
        }
        size='icon-sm'
        type='button'
        variant='ghost'
      >
        <ChevronRightIcon className='size-3.5' />
      </Button>
    </div>
  )
}
