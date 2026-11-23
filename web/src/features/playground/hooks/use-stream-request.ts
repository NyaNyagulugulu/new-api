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
import { useCallback, useEffect, useRef, useState } from 'react'
import { SSE } from 'sse.js'

import { getFreshAuthHeaders } from '@/lib/api'

import { API_ENDPOINTS, ERROR_MESSAGES } from '../constants'
import {
  getStreamReadyStateError,
  isStreamClosedReadyState,
  isStreamDoneMessage,
  parseStreamErrorDetails,
  parseStreamMessageUpdates,
  parseStreamUsage,
} from '../lib'
import type { ChatCompletionRequest, ChatCompletionUsage } from '../types'

interface StreamEventSource {
  readyState?: number
  addEventListener: (
    type: string,
    listener: (event: Event & { data?: string; readyState?: number }) => void
  ) => void
  close: () => void
  stream: () => void
}

interface StreamRequestCallbacks {
  onUpdate: (type: 'reasoning' | 'content', chunk: string) => void
  onComplete: (usage?: ChatCompletionUsage) => void
  onError: (error: string, errorCode?: string) => void
}

interface StreamRequestControllerRuntime {
  getHeaders: () => Promise<Record<string, string>>
  createSource: (
    payload: ChatCompletionRequest,
    headers: Record<string, string>
  ) => StreamEventSource
  setStreaming: (streaming: boolean) => void
}

export function createStreamRequestController(
  runtime: StreamRequestControllerRuntime
) {
  let source: StreamEventSource | null = null
  let generation = 0

  const closeActiveSource = (target: StreamEventSource) => {
    target.close()
    if (source === target) {
      source = null
      runtime.setStreaming(false)
    }
  }

  const send = async (
    payload: ChatCompletionRequest,
    callbacks: StreamRequestCallbacks
  ) => {
    const requestGeneration = generation + 1
    generation = requestGeneration
    const previousSource = source
    source = null
    previousSource?.close()
    runtime.setStreaming(false)

    let headers: Record<string, string>
    try {
      headers = await runtime.getHeaders()
    } catch (error: unknown) {
      if (generation !== requestGeneration) return
      callbacks.onError(
        error instanceof Error
          ? error.message
          : ERROR_MESSAGES.STREAM_START_ERROR
      )
      return
    }
    if (generation !== requestGeneration) return

    const nextSource = runtime.createSource(payload, headers)
    source = nextSource
    runtime.setStreaming(true)
    let completed = false
    let receivedMessage = false
    let latestUsage: ChatCompletionUsage | undefined

    const isCurrent = () =>
      generation === requestGeneration && source === nextSource

    const finish = () => {
      if (!isCurrent() || completed) return
      completed = true
      closeActiveSource(nextSource)
      callbacks.onComplete(latestUsage)
    }

    const handleError = (errorMessage: string, errorCode?: string) => {
      if (!isCurrent() || completed) return
      completed = true
      callbacks.onError(errorMessage, errorCode)
      closeActiveSource(nextSource)
    }

    nextSource.addEventListener('message', (event) => {
      if (!isCurrent() || completed) return
      const data = event.data ?? ''
      receivedMessage = true
      if (isStreamDoneMessage(data)) {
        finish()
        return
      }

      try {
        const usage = parseStreamUsage(data)
        if (usage) latestUsage = usage
        const updates = parseStreamMessageUpdates(data)

        for (const update of updates) {
          callbacks.onUpdate(update.type, update.chunk)
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to parse SSE message:', error)
        handleError(ERROR_MESSAGES.PARSE_ERROR)
      }
    })

    nextSource.addEventListener('error', (event) => {
      if (!isCurrent() || completed) return
      if (isStreamClosedReadyState(nextSource.readyState)) {
        if (receivedMessage) {
          finish()
        } else {
          handleError(ERROR_MESSAGES.CONNECTION_CLOSED)
        }
        return
      }

      // eslint-disable-next-line no-console
      console.error('SSE Error:', event)
      const { errorCode, errorMessage } = parseStreamErrorDetails(event.data)
      handleError(errorMessage, errorCode)
    })

    nextSource.addEventListener('readystatechange', (event) => {
      if (!isCurrent() || completed) return
      const errorMessage = getStreamReadyStateError(
        event.readyState,
        nextSource
      )

      if (errorMessage) {
        handleError(errorMessage)
        return
      }

      if (isStreamClosedReadyState(event.readyState)) {
        if (receivedMessage) {
          finish()
        } else {
          handleError(ERROR_MESSAGES.CONNECTION_CLOSED)
        }
      }
    })

    try {
      if (!isCurrent()) return
      nextSource.stream()
    } catch (error: unknown) {
      if (!isCurrent() || completed) return
      // eslint-disable-next-line no-console
      console.error('Failed to start SSE stream:', error)
      handleError(ERROR_MESSAGES.STREAM_START_ERROR)
    }
  }

  const cancel = (notify: boolean) => {
    generation += 1
    const activeSource = source
    source = null
    activeSource?.close()
    if (notify) runtime.setStreaming(false)
  }

  const stop = () => cancel(true)
  const dispose = () => cancel(false)

  return { send, stop, dispose }
}

/**
 * Hook for handling streaming chat completion requests
 */
export function useStreamRequest() {
  const controllersRef = useRef(
    new Map<string, ReturnType<typeof createStreamRequestController>>()
  )
  const [streamingIds, setStreamingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  const sendStreamRequest = useCallback(
    (
      requestId: string,
      payload: ChatCompletionRequest,
      onUpdate: (type: 'reasoning' | 'content', chunk: string) => void,
      onComplete: (usage?: ChatCompletionUsage) => void,
      onError: (error: string, errorCode?: string) => void
    ) => {
      controllersRef.current.get(requestId)?.stop()

      const finish = () => {
        controllersRef.current.delete(requestId)
        setStreamingIds((current) => {
          if (!current.has(requestId)) return current
          const next = new Set(current)
          next.delete(requestId)
          return next
        })
      }

      const controller = createStreamRequestController({
        getHeaders: getFreshAuthHeaders,
        createSource: (requestPayload, headers) =>
          new SSE(API_ENDPOINTS.CHAT_COMPLETIONS, {
            headers,
            method: 'POST',
            payload: JSON.stringify(requestPayload),
          }) as StreamEventSource,
        setStreaming: () => undefined,
      })
      controllersRef.current.set(requestId, controller)
      setStreamingIds((current) => new Set(current).add(requestId))

      void controller.send(payload, {
        onUpdate,
        onComplete: (usage) => {
          finish()
          onComplete(usage)
        },
        onError: (error, errorCode) => {
          finish()
          onError(error, errorCode)
        },
      })
    },
    []
  )

  const stopStream = useCallback((requestId?: string) => {
    const ids = requestId ? [requestId] : [...controllersRef.current.keys()]

    for (const id of ids) {
      controllersRef.current.get(id)?.stop()
      controllersRef.current.delete(id)
    }

    setStreamingIds((current) => {
      if (ids.every((id) => !current.has(id))) return current
      const next = new Set(current)
      for (const id of ids) next.delete(id)
      return next
    })
  }, [])

  useEffect(
    () => () => {
      for (const controller of controllersRef.current.values()) {
        controller.dispose()
      }
      controllersRef.current.clear()
    },
    []
  )

  return {
    sendStreamRequest,
    stopStream,
    isStreaming: streamingIds.size > 0,
    isStreamingRequest: (requestId: string) => streamingIds.has(requestId),
  }
}
