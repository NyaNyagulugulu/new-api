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
import type { FileUIPart } from 'ai'

import type { GroupOption, ModelOption } from '../../types'

type InputControlStateOptions = {
  disabled?: boolean
  groups: GroupOption[]
  hasAttachments: boolean
  hasStopHandler: boolean
  isGenerating?: boolean
  isModelLoading?: boolean
  models: ModelOption[]
  text: string
}

type InputControlState = {
  canSubmit: boolean
  isSelectorDisabled: boolean
  shouldShowStop: boolean
}

type SubmittableInputMessage = {
  text?: string | null
  files?: FileUIPart[]
}

type SubmittableInputContent = {
  text: string
  files: FileUIPart[]
}

export function getSubmittableInputContent(
  message: SubmittableInputMessage,
  disabled?: boolean
): SubmittableInputContent | null {
  const text = message.text?.trim() ?? ''
  const files = message.files ?? []
  if (disabled || (!text && files.length === 0)) {
    return null
  }

  return { text, files }
}

export function getInputControlState({
  disabled,
  groups,
  hasAttachments,
  hasStopHandler,
  isGenerating,
  isModelLoading,
  models,
  text,
}: InputControlStateOptions): InputControlState {
  const hasModels = models.length > 0

  return {
    canSubmit:
      !disabled && hasModels && (text.trim().length > 0 || hasAttachments),
    isSelectorDisabled: disabled || isModelLoading || groups.length === 0,
    shouldShowStop: Boolean(isGenerating && hasStopHandler),
  }
}
