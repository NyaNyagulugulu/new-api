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
import { Claude, DeepSeek, Gemini, OpenAI, Qwen } from '@lobehub/icons'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'

const MODEL_ICONS: { key: string; render: (size: number) => ReactNode }[] = [
  { key: 'deepseek', render: (size) => <DeepSeek.Color size={size} /> },
  { key: 'openai', render: (size) => <OpenAI.Avatar size={size} /> },
  { key: 'claude', render: (size) => <Claude.Color size={size} /> },
  { key: 'gemini', render: (size) => <Gemini.Color size={size} /> },
  { key: 'qwen', render: (size) => <Qwen.Color size={size} /> },
]

type RotatingModelIconProps = {
  size?: number
}

export function RotatingModelIcon(props: RotatingModelIconProps) {
  const shouldReduceMotion = useReducedMotion()
  const [iconIndex, setIconIndex] = useState(0)

  useEffect(() => {
    if (shouldReduceMotion) return

    const intervalId = window.setInterval(() => {
      setIconIndex((current) => (current + 1) % MODEL_ICONS.length)
    }, 1800)
    return () => window.clearInterval(intervalId)
  }, [shouldReduceMotion])

  const icon = MODEL_ICONS[iconIndex] ?? MODEL_ICONS[0]
  return (
    <span
      aria-hidden='true'
      className='animate-in fade-in zoom-in-75 flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white shadow-xs ring-1 ring-black/10 duration-300'
      key={icon.key}
    >
      {icon.render(props.size ?? 18)}
    </span>
  )
}
