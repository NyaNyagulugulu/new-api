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
import { useTranslation } from 'react-i18next'

import { handleServerError } from '@/lib/handle-server-error'

import { sendChatCompletion } from '../api'
import { ERROR_MESSAGES } from '../constants'
import {
  applyStreamingChunk,
  buildChatCompletionPayload,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
  parseRequestErrorDetails,
  applyChatCompletionResponse,
  completeAssistantMessage,
  hasChatCompletionChoice,
  isAssistantMessageFinal,
  isAssistantMessagePending,
  normalizeMessageUsage,
} from '../lib'
import type {
  ChatCompletionUsage,
  Message,
  PlaygroundConfig,
  ParameterEnabled,
} from '../types'
import { useStreamRequest } from './use-stream-request'

interface UseChatHandlerOptions {
  config: PlaygroundConfig
  parameterEnabled: ParameterEnabled
  onMessageUpdate: (
    updater: (prev: Message[]) => Message[],
    sessionId?: string
  ) => void
}

const KNOWN_ERROR_MESSAGES = new Set<string>(Object.values(ERROR_MESSAGES))
const STREAM_UPDATE_FLUSH_MS = 50

type PendingStreamChunks = {
  content: string
  reasoning: string
}

type ActiveGeneration = {
  abortController: AbortController | null
  pending: PendingStreamChunks
  sessionId?: string
  timer: number | null
}

function mergePendingStreamChunk(
  currentChunk: string,
  nextChunk: string
): string {
  if (!currentChunk || !nextChunk.startsWith(currentChunk)) {
    return currentChunk + nextChunk
  }

  return nextChunk
}

/**
 * Handles independent chat requests so conversations can keep generating while
 * the user switches to another chat.
 */
export function useChatHandler({
  config,
  parameterEnabled,
  onMessageUpdate,
}: UseChatHandlerOptions) {
  const { t } = useTranslation()
  const { sendStreamRequest, stopStream } = useStreamRequest()
  const [generatingSessionIds, setGeneratingSessionIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const generationsRef = useRef(new Map<number, ActiveGeneration>())
  const sessionGenerationRef = useRef(new Map<string, number>())
  const nextGenerationRef = useRef(1)

  const setSessionGenerating = useCallback(
    (sessionId: string | undefined, active: boolean) => {
      if (!sessionId) return
      setGeneratingSessionIds((current) => {
        if (active === current.has(sessionId)) return current
        const next = new Set(current)
        if (active) {
          next.add(sessionId)
        } else {
          next.delete(sessionId)
        }
        return next
      })
    },
    []
  )

  const removeGeneration = useCallback(
    (generation: number, sessionId: string | undefined) => {
      const request = generationsRef.current.get(generation)
      if (request?.timer !== null && request?.timer !== undefined) {
        window.clearTimeout(request.timer)
      }
      generationsRef.current.delete(generation)
      if (
        sessionId &&
        sessionGenerationRef.current.get(sessionId) === generation
      ) {
        sessionGenerationRef.current.delete(sessionId)
      }
      setSessionGenerating(sessionId, false)
    },
    [setSessionGenerating]
  )

  const flushStreamUpdates = useCallback(
    (generation: number) => {
      const request = generationsRef.current.get(generation)
      if (!request) return
      if (request.timer !== null) {
        window.clearTimeout(request.timer)
        request.timer = null
      }
      const { content, reasoning } = request.pending
      if (!reasoning && !content) return

      request.pending = { content: '', reasoning: '' }
      onMessageUpdate((prev) => {
        if (!generationsRef.current.has(generation)) return prev
        return updateLastAssistantMessage(prev, (message) => {
          let updatedMessage = message
          if (reasoning) {
            updatedMessage = applyStreamingChunk(
              updatedMessage,
              'reasoning',
              reasoning
            )
          }
          if (content) {
            updatedMessage = applyStreamingChunk(
              updatedMessage,
              'content',
              content
            )
          }
          return updatedMessage
        })
      }, request.sessionId)
    },
    [onMessageUpdate]
  )

  const scheduleStreamFlush = useCallback(
    (generation: number) => {
      const request = generationsRef.current.get(generation)
      if (!request || request.timer !== null) return
      request.timer = window.setTimeout(() => {
        const current = generationsRef.current.get(generation)
        if (!current) return
        current.timer = null
        flushStreamUpdates(generation)
      }, STREAM_UPDATE_FLUSH_MS)
    },
    [flushStreamUpdates]
  )

  useEffect(
    () => () => {
      for (const request of generationsRef.current.values()) {
        if (request.timer !== null) {
          window.clearTimeout(request.timer)
        }
        request.abortController?.abort()
      }
    },
    []
  )

  const getDisplayError = useCallback(
    (error: string) => {
      if (KNOWN_ERROR_MESSAGES.has(error)) {
        return t(error)
      }

      const connectionClosedSuffix = `: ${ERROR_MESSAGES.CONNECTION_CLOSED}`
      if (error.endsWith(connectionClosedSuffix)) {
        return `${error.slice(0, -ERROR_MESSAGES.CONNECTION_CLOSED.length)}${t(
          ERROR_MESSAGES.CONNECTION_CLOSED
        )}`
      }

      return error
    },
    [t]
  )

  const handleStreamUpdate = useCallback(
    (generation: number, type: 'reasoning' | 'content', chunk: string) => {
      const request = generationsRef.current.get(generation)
      if (!request) return
      request.pending[type] = mergePendingStreamChunk(
        request.pending[type],
        chunk
      )
      scheduleStreamFlush(generation)
    },
    [scheduleStreamFlush]
  )

  const handleStreamComplete = useCallback(
    (generation: number, usage?: ChatCompletionUsage) => {
      const request = generationsRef.current.get(generation)
      if (!request) return
      flushStreamUpdates(generation)
      removeGeneration(generation, request.sessionId)
      onMessageUpdate(
        (prev) =>
          updateLastAssistantMessage(prev, (message) => {
            const completedMessage = {
              ...message,
              ...(usage
                ? {
                    usage: normalizeMessageUsage(
                      usage,
                      config.model,
                      config.group,
                      config.reasoningEffort
                    ),
                  }
                : {}),
            }
            return isAssistantMessageFinal(completedMessage)
              ? completedMessage
              : completeAssistantMessage(completedMessage)
          }),
        request.sessionId
      )
    },
    [
      config.group,
      config.model,
      config.reasoningEffort,
      flushStreamUpdates,
      onMessageUpdate,
      removeGeneration,
    ]
  )

  const handleStreamError = useCallback(
    (generation: number, error: string, errorCode?: string) => {
      const request = generationsRef.current.get(generation)
      if (!request) return
      flushStreamUpdates(generation)
      removeGeneration(generation, request.sessionId)
      const displayError = getDisplayError(error)
      handleServerError(new Error(displayError))
      const errorTitle = t(ERROR_MESSAGES.API_REQUEST_ERROR)
      onMessageUpdate(
        (prev) =>
          updateAssistantMessageWithError(
            prev,
            displayError,
            errorCode,
            errorTitle
          ),
        request.sessionId
      )
    },
    [flushStreamUpdates, getDisplayError, onMessageUpdate, removeGeneration, t]
  )

  const cancelGeneration = useCallback(
    (generation: number, finalizeMessage: boolean) => {
      const request = generationsRef.current.get(generation)
      if (!request) return
      if (finalizeMessage) {
        flushStreamUpdates(generation)
      }
      request.abortController?.abort()
      stopStream(String(generation))
      removeGeneration(generation, request.sessionId)
      if (!finalizeMessage) return

      onMessageUpdate(
        (prev) =>
          updateLastAssistantMessage(prev, (message) =>
            isAssistantMessagePending(message)
              ? completeAssistantMessage(message)
              : message
          ),
        request.sessionId
      )
    },
    [flushStreamUpdates, onMessageUpdate, removeGeneration, stopStream]
  )

  const prepareGeneration = useCallback(
    (sessionId?: string) => {
      if (sessionId) {
        const previousGeneration = sessionGenerationRef.current.get(sessionId)
        if (previousGeneration !== undefined) {
          cancelGeneration(previousGeneration, true)
        }
      }

      const generation = nextGenerationRef.current
      nextGenerationRef.current += 1
      const request: ActiveGeneration = {
        abortController: null,
        pending: { content: '', reasoning: '' },
        sessionId,
        timer: null,
      }
      generationsRef.current.set(generation, request)
      if (sessionId) {
        sessionGenerationRef.current.set(sessionId, generation)
      }
      setSessionGenerating(sessionId, true)
      return generation
    },
    [cancelGeneration, setSessionGenerating]
  )

  const sendStreamingChat = useCallback(
    (messages: Message[], sessionId?: string) => {
      const generation = prepareGeneration(sessionId)
      const payload = buildChatCompletionPayload(
        messages,
        config,
        parameterEnabled
      )
      sendStreamRequest(
        String(generation),
        payload,
        (type, chunk) => handleStreamUpdate(generation, type, chunk),
        (usage) => handleStreamComplete(generation, usage),
        (error, errorCode) => handleStreamError(generation, error, errorCode)
      )
    },
    [
      config,
      handleStreamComplete,
      handleStreamError,
      handleStreamUpdate,
      parameterEnabled,
      prepareGeneration,
      sendStreamRequest,
    ]
  )

  const sendNonStreamingChat = useCallback(
    async (messages: Message[], sessionId?: string) => {
      const generation = prepareGeneration(sessionId)
      const request = generationsRef.current.get(generation)
      if (!request) return

      const abortController = new AbortController()
      request.abortController = abortController
      const payload = buildChatCompletionPayload(
        messages,
        config,
        parameterEnabled
      )

      try {
        const response = await sendChatCompletion(
          payload,
          abortController.signal
        )
        if (
          abortController.signal.aborted ||
          !generationsRef.current.has(generation)
        ) {
          return
        }

        if (!hasChatCompletionChoice(response)) {
          handleStreamError(generation, ERROR_MESSAGES.API_REQUEST_ERROR)
          return
        }

        removeGeneration(generation, sessionId)
        onMessageUpdate(
          (prev) =>
            updateLastAssistantMessage(prev, (message) => {
              const updatedMessage = applyChatCompletionResponse(
                message,
                response,
                config.model,
                config.group,
                config.reasoningEffort
              )
              return updatedMessage ?? message
            }),
          sessionId
        )
      } catch (error: unknown) {
        if (abortController.signal.aborted) return
        const { errorCode, errorMessage } = parseRequestErrorDetails(error)
        handleStreamError(generation, errorMessage, errorCode)
      }
    },
    [
      config,
      handleStreamError,
      onMessageUpdate,
      parameterEnabled,
      prepareGeneration,
      removeGeneration,
    ]
  )

  const sendChat = useCallback(
    (messages: Message[], sessionId?: string) => {
      if (config.stream) {
        sendStreamingChat(messages, sessionId)
      } else {
        void sendNonStreamingChat(messages, sessionId)
      }
    },
    [config.stream, sendNonStreamingChat, sendStreamingChat]
  )

  const stopGeneration = useCallback(
    (sessionId?: string) => {
      const generations = sessionId
        ? [sessionGenerationRef.current.get(sessionId)].filter(
            (generation): generation is number => generation !== undefined
          )
        : [...generationsRef.current.keys()]

      for (const generation of generations) {
        cancelGeneration(generation, true)
      }
    },
    [cancelGeneration]
  )

  return {
    sendChat,
    stopGeneration,
    generatingSessionIds,
    isGenerating: generatingSessionIds.size > 0,
  }
}
