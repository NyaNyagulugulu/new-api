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

import { searchUserMemories, sendChatCompletion } from '../api'
import { ERROR_MESSAGES } from '../constants'
import {
  addPersonaContext,
  addLongTermMemoryContext,
  applyStreamingChunk,
  buildChatCompletionPayload,
  buildContextSummaryRequestMessages,
  applyChatCompletionResponse,
  completeAssistantMessage,
  CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
  createContextSummaryMessage,
  getUserMemoryQuery,
  hasChatCompletionChoice,
  insertContextSummaryMessage,
  isAssistantMessageFinal,
  isAssistantMessagePending,
  mergeChatCompletionUsage,
  normalizeMessageUsage,
  parseRequestErrorDetails,
  planContextCompaction,
  shouldCompactContext,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
} from '../lib'
import type {
  ChatCompletionResponse,
  ChatCompletionUsage,
  Message,
  MemorySettings,
  PlaygroundConfig,
  ParameterEnabled,
  UserMemory,
  UserPersona,
  WebSearchSource,
  WebSearchStatus,
} from '../types'
import { useStreamRequest } from './use-stream-request'

interface UseChatHandlerOptions {
  config: PlaygroundConfig
  contextWindowTokens?: number
  memorySettings?: MemorySettings
  parameterEnabled: ParameterEnabled
  persona?: UserPersona
  personaId?: number
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
  auxiliaryCostUSD: number
  auxiliaryUsage?: ChatCompletionUsage
  pending: PendingStreamChunks
  sessionId?: string
  timer: number | null
}

function getChatCompletionText(response: ChatCompletionResponse): string {
  const message = response.choices?.[0]?.message
  return (
    message?.content ||
    message?.reasoning_content ||
    message?.reasoning ||
    ''
  ).trim()
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

function applyPendingStreamChunks(
  message: Message,
  pending: PendingStreamChunks
): Message {
  let updatedMessage = message
  if (pending.reasoning) {
    updatedMessage = applyStreamingChunk(
      updatedMessage,
      'reasoning',
      pending.reasoning
    )
  }
  if (pending.content) {
    updatedMessage = applyStreamingChunk(
      updatedMessage,
      'content',
      pending.content
    )
  }
  return updatedMessage
}

/**
 * Handles independent chat requests so conversations can keep generating while
 * the user switches to another chat.
 */
export function useChatHandler({
  config,
  contextWindowTokens,
  memorySettings,
  parameterEnabled,
  persona,
  personaId,
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

  const drainPendingStreamUpdates = useCallback((generation: number) => {
    const request = generationsRef.current.get(generation)
    if (!request) return null
    if (request.timer !== null) {
      window.clearTimeout(request.timer)
      request.timer = null
    }
    const pending = request.pending
    request.pending = { content: '', reasoning: '' }
    if (!pending.content && !pending.reasoning) return null
    return {
      pending,
      sessionId: request.sessionId,
    }
  }, [])

  const flushStreamUpdates = useCallback(
    (generation: number) => {
      const streamUpdate = drainPendingStreamUpdates(generation)
      if (!streamUpdate) return

      onMessageUpdate(
        (prev) =>
          updateLastAssistantMessage(prev, (message) =>
            applyPendingStreamChunks(message, streamUpdate.pending)
          ),
        streamUpdate.sessionId
      )
    },
    [drainPendingStreamUpdates, onMessageUpdate]
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

  const handleWebSearchStatus = useCallback(
    (
      generation: number,
      status: WebSearchStatus,
      sources: WebSearchSource[]
    ) => {
      const request = generationsRef.current.get(generation)
      if (!request) return
      onMessageUpdate(
        (prev) =>
          updateLastAssistantMessage(prev, (message) => ({
            ...message,
            webSearch: { status },
            ...(sources.length > 0 ? { sources } : {}),
          })),
        request.sessionId
      )
    },
    [onMessageUpdate]
  )

  const handleStreamComplete = useCallback(
    (generation: number, usage?: ChatCompletionUsage) => {
      const request = generationsRef.current.get(generation)
      if (!request) return
      const streamUpdate = drainPendingStreamUpdates(generation)
      const mergedUsage = mergeChatCompletionUsage(
        usage,
        request.auxiliaryUsage
      )
      removeGeneration(generation, request.sessionId)
      onMessageUpdate(
        (prev) =>
          updateLastAssistantMessage(prev, (message) => {
            const streamedMessage = streamUpdate
              ? applyPendingStreamChunks(message, streamUpdate.pending)
              : message
            const completedMessage = {
              ...streamedMessage,
              model: config.model,
              ...(streamedMessage.webSearch?.status === 'searching'
                ? { webSearch: { status: 'used' as const } }
                : {}),
              ...(mergedUsage
                ? {
                    usage: {
                      ...normalizeMessageUsage(
                        mergedUsage,
                        config.model,
                        config.group,
                        config.reasoningEffort
                      ),
                      auxiliaryCostUSD: request.auxiliaryCostUSD,
                    },
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
      drainPendingStreamUpdates,
      onMessageUpdate,
      removeGeneration,
    ]
  )

  const handleStreamError = useCallback(
    (generation: number, error: string, errorCode?: string) => {
      const request = generationsRef.current.get(generation)
      if (!request) return
      const streamUpdate = drainPendingStreamUpdates(generation)
      removeGeneration(generation, request.sessionId)
      const displayError = getDisplayError(error)
      handleServerError(new Error(displayError))
      const errorTitle = t(ERROR_MESSAGES.API_REQUEST_ERROR)
      onMessageUpdate(
        (prev) =>
          updateLastAssistantMessage(
            updateAssistantMessageWithError(
              streamUpdate
                ? updateLastAssistantMessage(prev, (message) =>
                    applyPendingStreamChunks(message, streamUpdate.pending)
                  )
                : prev,
              displayError,
              errorCode,
              errorTitle
            ),
            (message) =>
              message.webSearch?.status === 'searching'
                ? { ...message, webSearch: { status: 'failed' } }
                : message
          ),
        request.sessionId
      )
    },
    [
      drainPendingStreamUpdates,
      getDisplayError,
      onMessageUpdate,
      removeGeneration,
      t,
    ]
  )

  const cancelGeneration = useCallback(
    (generation: number, finalizeMessage: boolean) => {
      const request = generationsRef.current.get(generation)
      if (!request) return
      const streamUpdate = finalizeMessage
        ? drainPendingStreamUpdates(generation)
        : null
      request.abortController?.abort()
      stopStream(String(generation))
      removeGeneration(generation, request.sessionId)
      if (!finalizeMessage) return

      onMessageUpdate(
        (prev) =>
          updateLastAssistantMessage(
            streamUpdate
              ? updateLastAssistantMessage(prev, (message) =>
                  applyPendingStreamChunks(message, streamUpdate.pending)
                )
              : prev,
            (message) => {
              const completed = isAssistantMessagePending(message)
                ? completeAssistantMessage(message)
                : message
              return completed.webSearch?.status === 'searching'
                ? { ...completed, webSearch: { status: 'failed' } }
                : completed
            }
          ),
        request.sessionId
      )
    },
    [drainPendingStreamUpdates, onMessageUpdate, removeGeneration, stopStream]
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
        auxiliaryCostUSD: 0,
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

  const startStreamingChat = useCallback(
    (
      messages: Message[],
      generation: number,
      memoryResults: UserMemory[] = []
    ) => {
      const payload = addPersonaContext(
        addLongTermMemoryContext(
          buildChatCompletionPayload(messages, config, parameterEnabled),
          memoryResults,
          memorySettings?.max_injected_chars ?? 0
        ),
        persona
      )
      sendStreamRequest(
        String(generation),
        payload,
        (type, chunk) => handleStreamUpdate(generation, type, chunk),
        (usage) => handleStreamComplete(generation, usage),
        (error, errorCode) => handleStreamError(generation, error, errorCode),
        (status, sources) => handleWebSearchStatus(generation, status, sources)
      )
    },
    [
      config,
      handleStreamComplete,
      handleStreamError,
      handleStreamUpdate,
      handleWebSearchStatus,
      parameterEnabled,
      memorySettings?.max_injected_chars,
      persona,
      sendStreamRequest,
    ]
  )

  const startNonStreamingChat = useCallback(
    async (
      messages: Message[],
      sessionId: string | undefined,
      generation: number,
      memoryResults: UserMemory[] = []
    ) => {
      const request = generationsRef.current.get(generation)
      if (!request) return

      const abortController = new AbortController()
      request.abortController = abortController
      const payload = addPersonaContext(
        addLongTermMemoryContext(
          buildChatCompletionPayload(messages, config, parameterEnabled),
          memoryResults,
          memorySettings?.max_injected_chars ?? 0
        ),
        persona
      )

      try {
        const response = await sendChatCompletion(
          payload,
          abortController.signal,
          (status, sources) =>
            handleWebSearchStatus(generation, status, sources)
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
        const mergedUsage = mergeChatCompletionUsage(
          response.usage,
          request.auxiliaryUsage
        )
        onMessageUpdate(
          (prev) =>
            updateLastAssistantMessage(prev, (message) => {
              const updatedMessage = applyChatCompletionResponse(
                message,
                { ...response, usage: mergedUsage },
                config.model,
                config.group,
                config.reasoningEffort
              )
              if (!updatedMessage) return message
              if (!updatedMessage.usage) return updatedMessage
              return {
                ...updatedMessage,
                usage: {
                  ...updatedMessage.usage,
                  auxiliaryCostUSD: request.auxiliaryCostUSD,
                },
              }
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
      handleWebSearchStatus,
      onMessageUpdate,
      parameterEnabled,
      memorySettings?.max_injected_chars,
      persona,
      removeGeneration,
    ]
  )

  const sendManagedChat = useCallback(
    async (messages: Message[], sessionId?: string) => {
      const generation = prepareGeneration(sessionId)
      const request = generationsRef.current.get(generation)
      if (!request) return

      const abortController = new AbortController()
      request.abortController = abortController
      let preparedMessages = messages
      let memoryResults: UserMemory[] = []

      try {
        if (
          shouldCompactContext(
            preparedMessages,
            contextWindowTokens ?? 0,
            parameterEnabled.max_tokens ? config.max_tokens : 0,
            (config.webSearch ? 4_000 : 0) +
              (memorySettings?.enabled
                ? Math.ceil((memorySettings.max_injected_chars ?? 0) / 4)
                : 0) +
              (persona && persona.id > 0 ? 1_000 : 0)
          )
        ) {
          const compaction = planContextCompaction(
            preparedMessages,
            contextWindowTokens ?? 0
          )
          if (compaction) {
            const response = await sendChatCompletion(
              {
                model: config.model,
                group: config.group,
                messages: buildContextSummaryRequestMessages(
                  compaction.sourceMessages
                ),
                stream: false,
                max_tokens: CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
              },
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

            const summary = getChatCompletionText(response)
            if (!summary) {
              handleStreamError(generation, ERROR_MESSAGES.API_REQUEST_ERROR)
              return
            }
            const summaryMessage = createContextSummaryMessage(summary)
            const request = generationsRef.current.get(generation)
            if (request) {
              request.auxiliaryUsage = mergeChatCompletionUsage(
                request.auxiliaryUsage,
                response.usage
              )
            }
            onMessageUpdate(
              (prev) =>
                insertContextSummaryMessage(
                  prev,
                  summaryMessage,
                  compaction.firstKeptMessageKey
                ),
              sessionId
            )
            preparedMessages = insertContextSummaryMessage(
              preparedMessages,
              summaryMessage,
              compaction.firstKeptMessageKey
            )
          }
        }

        const query = memorySettings?.enabled
          ? getUserMemoryQuery(preparedMessages)
          : ''
        if (
          query &&
          memorySettings?.enabled &&
          memorySettings.retrieve_limit > 0
        ) {
          try {
            memoryResults = await searchUserMemories(
              query,
              config.group,
              personaId ?? persona?.id ?? 0,
              abortController.signal
            )
          } catch {
            memoryResults = []
          }
        }
        if (
          abortController.signal.aborted ||
          !generationsRef.current.has(generation)
        ) {
          return
        }

        if (config.stream) {
          startStreamingChat(preparedMessages, generation, memoryResults)
          return
        }
        await startNonStreamingChat(
          preparedMessages,
          sessionId,
          generation,
          memoryResults
        )
      } catch (error: unknown) {
        if (abortController.signal.aborted) return
        const { errorCode, errorMessage } = parseRequestErrorDetails(error)
        handleStreamError(generation, errorMessage, errorCode)
      }
    },
    [
      config.group,
      config.max_tokens,
      config.model,
      config.stream,
      config.webSearch,
      contextWindowTokens,
      handleStreamError,
      memorySettings,
      onMessageUpdate,
      parameterEnabled.max_tokens,
      persona,
      personaId,
      prepareGeneration,
      startNonStreamingChat,
      startStreamingChat,
    ]
  )

  const sendChat = useCallback(
    (messages: Message[], sessionId?: string) => {
      onMessageUpdate(
        (prev) =>
          updateLastAssistantMessage(prev, (message) => ({
            ...message,
            model: config.model,
            ...(config.webSearch
              ? { webSearch: { status: 'searching' as const } }
              : {}),
          })),
        sessionId
      )
      void sendManagedChat(messages, sessionId)
    },
    [config.model, config.webSearch, onMessageUpdate, sendManagedChat]
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
