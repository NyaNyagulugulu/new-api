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
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { createLoadingAssistantMessage } from '../../../lib'
import { PlaygroundMessageContent } from '../playground-message-content'

test('uses the DeepSeek animation while a DeepSeek response is thinking', () => {
  const message = {
    ...createLoadingAssistantMessage(0),
    model: 'deepseek-chat',
    reasoning: {
      content: 'Analyzing the request',
      duration: 0,
    },
    isReasoningStreaming: true,
    status: 'streaming' as const,
  }

  render(
    <PlaygroundMessageContent
      actions={null}
      alignment='left'
      message={message}
      versionContent=''
    />
  )

  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(screen.getByTestId('deepseek-thinking')).toBeInTheDocument()
})

test('keeps the standard loader for other models', () => {
  const message = {
    ...createLoadingAssistantMessage(0),
    model: 'gpt-4o',
  }

  render(
    <PlaygroundMessageContent
      actions={null}
      alignment='left'
      message={message}
      versionContent=''
    />
  )

  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(screen.queryByTestId('deepseek-thinking')).not.toBeInTheDocument()
})
