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

import { handleServerError } from '@/lib/handle-server-error'

import {
  deleteChatConversation,
  getChatConversation,
  getChatConversations,
  syncChatConversations,
} from '../api'
import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../constants'
import {
  applyMessageStateUpdate,
  createChatSessionId,
  createChatSession,
  getChatSessionLatestMessageTime,
  getChatSessionRecencyTime,
  getInitialParameterEnabled,
  getInitialPlaygroundConfig,
  loadActiveChatSessionId,
  loadChatSessions,
  mergeChatSessions,
  saveActiveChatSessionId,
  saveChatSessions,
  saveConfig,
  saveParameterEnabled,
  type MessageStateUpdater,
} from '../lib'
import type {
  ChatSession,
  ChatConversationPage,
  ImportedChatSession,
  Message,
  PlaygroundConfig,
  ParameterEnabled,
  ModelOption,
  GroupOption,
} from '../types'

const SESSION_SAVE_DEBOUNCE_MS = 500
const SERVER_SYNC_DEBOUNCE_MS = 1200
const SERVER_SYNC_BATCH_SIZE = 50
const SERVER_SYNC_BATCH_BYTES = 24 * 1024 * 1024
const HISTORY_PAGE_SIZE = 30
const EMPTY_MESSAGES: Message[] = []
type SyncedSessionState = Pick<ChatSession, 'title' | 'updatedAt' | 'personaId'>

/**
 * Main state management hook for the web chat.
 */
export function usePlaygroundState(initialSessionId: string | null = null) {
  const [config, setConfig] = useState<PlaygroundConfig>(
    getInitialPlaygroundConfig
  )
  const [parameterEnabled, setParameterEnabled] = useState<ParameterEnabled>(
    getInitialParameterEnabled
  )
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  )
  const [isLoadingMessages, setIsLoadingMessages] = useState(true)
  const [hasMoreServerSessions, setHasMoreServerSessions] = useState(false)
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] = useState(false)
  const [visibleSessionLimit, setVisibleSessionLimit] =
    useState(HISTORY_PAGE_SIZE)
  const [models, setModels] = useState<ModelOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])

  const activeSessionIdRef = useRef<string | null>(null)
  const personaIdRef = useRef(config.personaId)
  const initialSessionIdRef = useRef(initialSessionId)
  const sessionsRef = useRef<ChatSession[]>([])
  const hasLoadedSessionsRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const serverSyncTimerRef = useRef<number | null>(null)
  const nextHistoryPageRef = useRef(2)
  const detailLoadRequestRef = useRef(0)
  const lastSyncedSessionsRef = useRef<Map<string, SyncedSessionState>>(
    new Map()
  )
  initialSessionIdRef.current = initialSessionId

  const setActiveSessionId = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = sessionId
    setActiveSessionIdState(sessionId)
  }, [])

  const applySessionDetail = useCallback((detail: ChatSession) => {
    const existing = sessionsRef.current.some(
      (session) => session.id === detail.id
    )
    const nextSessions = existing
      ? sessionsRef.current.map((session) =>
          session.id === detail.id
            ? {
                ...detail,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
              }
            : session
        )
      : [...sessionsRef.current, detail]
    const sorted = nextSessions.sort(
      (left, right) =>
        getChatSessionRecencyTime(right) - getChatSessionRecencyTime(left) ||
        left.id.localeCompare(right.id)
    )
    sessionsRef.current = sorted
    setSessions(sorted)
  }, [])

  const loadSessionDetail = useCallback(
    async (sessionId: string) => {
      const requestId = ++detailLoadRequestRef.current
      setIsLoadingMessages(true)
      try {
        const detail = await getChatConversation(sessionId)
        if (requestId !== detailLoadRequestRef.current) return
        applySessionDetail(detail)
      } catch (error) {
        if (requestId === detailLoadRequestRef.current) {
          handleServerError(error)
        }
      } finally {
        if (requestId === detailLoadRequestRef.current) {
          setIsLoadingMessages(false)
        }
      }
    },
    [applySessionDetail]
  )

  const syncPendingSessions = useCallback(() => {
    const currentSessions = sessionsRef.current
    const changedSessions = currentSessions.filter((session) => {
      if (session.messagesLoaded === false) return false
      if (session.messages.length === 0) return false
      const previous = lastSyncedSessionsRef.current.get(session.id)
      return (
        !previous ||
        previous.updatedAt !== session.updatedAt ||
        previous.title !== session.title ||
        previous.personaId !== session.personaId
      )
    })
    if (changedSessions.length === 0) return

    const batches: ChatSession[][] = []
    let batch: ChatSession[] = []
    let batchBytes = 0
    for (const session of changedSessions) {
      const sessionBytes = new TextEncoder().encode(
        JSON.stringify(session.messages)
      ).byteLength
      if (
        batch.length > 0 &&
        (batch.length >= SERVER_SYNC_BATCH_SIZE ||
          batchBytes + sessionBytes > SERVER_SYNC_BATCH_BYTES)
      ) {
        batches.push(batch)
        batch = []
        batchBytes = 0
      }
      batch.push(session)
      batchBytes += sessionBytes
    }
    if (batch.length > 0) {
      batches.push(batch)
    }

    void (async () => {
      for (const sessionsBatch of batches) {
        const changedSnapshot = sessionsBatch.map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          personaId: session.personaId,
        }))
        try {
          await syncChatConversations(sessionsBatch)
        } catch {
          // Keep this batch unsynced so a later edit retries the upload.
          continue
        }

        const currentSessionsById = new Map(
          sessionsRef.current.map((session) => [session.id, session])
        )
        for (const session of changedSnapshot) {
          if (!currentSessionsById.has(session.id)) continue
          const previous = lastSyncedSessionsRef.current.get(session.id)
          if (
            previous &&
            (previous.updatedAt > session.updatedAt ||
              (previous.updatedAt === session.updatedAt &&
                (previous.title !== session.title ||
                  previous.personaId !== session.personaId)))
          ) {
            continue
          }
          lastSyncedSessionsRef.current.set(session.id, {
            title: session.title,
            updatedAt: session.updatedAt,
            personaId: session.personaId,
          })
        }
      }
    })()
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const localSessions = loadChatSessions()
      let serverPage: ChatConversationPage = {
        sessions: [],
        page: 1,
        pageSize: HISTORY_PAGE_SIZE,
        total: 0,
        hasMore: false,
      }
      try {
        serverPage = await getChatConversations(1, HISTORY_PAGE_SIZE)
      } catch {
        // Local storage remains the fallback while the server is unavailable.
      }
      if (cancelled) return

      let loadedSessions = mergeChatSessions(localSessions, serverPage.sessions)
      const requestedSessionId = initialSessionIdRef.current
      const storedActiveSessionId = loadActiveChatSessionId()
      let nextActiveSessionId =
        requestedSessionId ??
        (loadedSessions.some((session) => session.id === storedActiveSessionId)
          ? storedActiveSessionId
          : (loadedSessions[0]?.id ?? null))
      const serverKnownSessions = [...serverPage.sessions]

      const activeSession = loadedSessions.find(
        (session) => session.id === nextActiveSessionId
      )
      if (
        nextActiveSessionId &&
        (!activeSession || activeSession.messagesLoaded === false)
      ) {
        try {
          const detail = await getChatConversation(nextActiveSessionId)
          if (cancelled) return
          const existingIndex = loadedSessions.findIndex(
            (session) => session.id === detail.id
          )
          const existingSession =
            existingIndex === -1 ? null : loadedSessions[existingIndex]
          const hydratedDetail = {
            ...detail,
            createdAt: existingSession?.createdAt ?? detail.createdAt,
            updatedAt: existingSession?.updatedAt ?? detail.updatedAt,
          }
          loadedSessions =
            existingIndex === -1
              ? [hydratedDetail, ...loadedSessions]
              : loadedSessions.map((session) =>
                  session.id === detail.id ? hydratedDetail : session
                )
          const knownIndex = serverKnownSessions.findIndex(
            (session) => session.id === detail.id
          )
          if (knownIndex === -1) {
            serverKnownSessions.push(hydratedDetail)
          } else {
            serverKnownSessions[knownIndex] = hydratedDetail
          }
        } catch {
          if (
            requestedSessionId &&
            !loadedSessions.some((session) => session.id === requestedSessionId)
          ) {
            loadedSessions = [
              createChatSession(
                [],
                Date.now(),
                requestedSessionId,
                personaIdRef.current
              ),
              ...loadedSessions,
            ]
          }
        }
      }

      if (cancelled) return
      nextActiveSessionId = loadedSessions.some(
        (session) => session.id === nextActiveSessionId
      )
        ? nextActiveSessionId
        : (loadedSessions[0]?.id ?? null)
      lastSyncedSessionsRef.current = new Map(
        serverKnownSessions.map((session) => [
          session.id,
          {
            title: session.title,
            updatedAt: session.updatedAt,
            personaId: session.personaId,
          },
        ])
      )
      sessionsRef.current = loadedSessions
      hasLoadedSessionsRef.current = true
      setSessions(loadedSessions)
      setActiveSessionId(nextActiveSessionId)
      nextHistoryPageRef.current = 2
      setHasMoreServerSessions(serverPage.hasMore)
      setVisibleSessionLimit(HISTORY_PAGE_SIZE)
      setIsLoadingMessages(false)
    }
    void load()

    return () => {
      cancelled = true
    }
  }, [setActiveSessionId])

  useEffect(() => {
    if (!initialSessionId || !hasLoadedSessionsRef.current) return
    const session = sessionsRef.current.find(
      (item) => item.id === initialSessionId
    )
    setActiveSessionId(initialSessionId)
    if (!session || session.messagesLoaded === false) {
      void loadSessionDetail(initialSessionId)
    }
  }, [initialSessionId, loadSessionDetail, setActiveSessionId])

  useEffect(() => {
    sessionsRef.current = sessions
    if (!hasLoadedSessionsRef.current) return

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    if (serverSyncTimerRef.current !== null) {
      window.clearTimeout(serverSyncTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      saveChatSessions(sessionsRef.current)
      saveActiveChatSessionId(activeSessionIdRef.current)
    }, SESSION_SAVE_DEBOUNCE_MS)

    serverSyncTimerRef.current = window.setTimeout(() => {
      serverSyncTimerRef.current = null
      syncPendingSessions()
    }, SERVER_SYNC_DEBOUNCE_MS)
  }, [activeSessionId, sessions, syncPendingSessions])

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveChatSessions(sessionsRef.current)
        saveActiveChatSessionId(activeSessionIdRef.current)
      }
      if (serverSyncTimerRef.current !== null) {
        window.clearTimeout(serverSyncTimerRef.current)
        syncPendingSessions()
      }
    },
    [syncPendingSessions]
  )

  const updateConfig = useCallback(
    <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) => {
      setConfig((previousConfig) => {
        const updated = { ...previousConfig, [key]: value }
        if (key === 'personaId' && typeof value === 'number') {
          personaIdRef.current = value
        }
        saveConfig(updated)
        return updated
      })
    },
    []
  )

  const updateParameterEnabled = useCallback(
    (key: keyof ParameterEnabled, value: boolean) => {
      setParameterEnabled((previousParameterEnabled) => {
        const updated = { ...previousParameterEnabled, [key]: value }
        saveParameterEnabled(updated)
        return updated
      })
    },
    []
  )

  const updateMessages = useCallback(
    (updater: MessageStateUpdater, sessionId?: string) => {
      const currentSessionId = sessionId ?? activeSessionIdRef.current
      const targetSessionId = currentSessionId ?? createChatSessionId()

      if (!currentSessionId) {
        setActiveSessionId(targetSessionId)
      }

      setSessions((previousSessions) => {
        const sessionIndex = previousSessions.findIndex(
          (session) => session.id === targetSessionId
        )

        if (sessionIndex === -1) {
          const initialMessages = applyMessageStateUpdate([], updater)
          if (initialMessages.length === 0) {
            return previousSessions
          }

          return [
            createChatSession(
              initialMessages,
              Date.now(),
              targetSessionId,
              personaIdRef.current
            ),
            ...previousSessions,
          ]
        }

        const currentSession = previousSessions[sessionIndex]
        const nextMessages = applyMessageStateUpdate(
          currentSession.messages,
          updater
        )
        if (nextMessages === currentSession.messages) {
          return previousSessions
        }

        const otherSessions = previousSessions.filter(
          (session) => session.id !== targetSessionId
        )
        if (nextMessages.length === 0) {
          const updatedAt = Math.max(
            currentSession.updatedAt,
            getChatSessionLatestMessageTime({
              ...currentSession,
              messages: nextMessages,
            }) || Date.now()
          )
          return [
            {
              ...currentSession,
              messages: [],
              updatedAt,
            },
            ...otherSessions,
          ]
        }

        const updatedAt = Math.max(
          currentSession.updatedAt,
          getChatSessionLatestMessageTime({
            ...currentSession,
            messages: nextMessages,
          }) || Date.now()
        )
        return [
          {
            ...currentSession,
            messages: nextMessages,
            updatedAt,
          },
          ...otherSessions,
        ]
      })
    },
    [setActiveSessionId]
  )

  const ensureActiveSessionId = useCallback(() => {
    const currentSessionId = activeSessionIdRef.current
    if (currentSessionId) return currentSessionId

    const sessionId = createChatSessionId()
    setActiveSessionId(sessionId)
    setSessions((previousSessions) => [
      createChatSession([], Date.now(), sessionId, personaIdRef.current),
      ...previousSessions,
    ])
    return sessionId
  }, [setActiveSessionId])

  const createNewChat = useCallback(() => {
    detailLoadRequestRef.current++
    setIsLoadingMessages(false)
    const activeSession = sessionsRef.current.find(
      (session) => session.id === activeSessionIdRef.current
    )
    const nextPersonaId = activeSession?.personaId ?? personaIdRef.current
    personaIdRef.current = nextPersonaId
    setConfig((previousConfig) => {
      if (previousConfig.personaId === nextPersonaId) {
        return previousConfig
      }
      const updated = { ...previousConfig, personaId: nextPersonaId }
      saveConfig(updated)
      return updated
    })
    setSessions((previousSessions) =>
      previousSessions.filter(
        (session) =>
          session.messagesLoaded === false || session.messages.length > 0
      )
    )
    setActiveSessionId(null)
  }, [setActiveSessionId])

  const selectPersona = useCallback(
    (personaId: number) => {
      const targetPersonaId = Math.max(0, personaId)
      const activeId = activeSessionIdRef.current
      if (!activeId) {
        updateConfig('personaId', targetPersonaId)
        return
      }
      personaIdRef.current = targetPersonaId
      setSessions((previousSessions) =>
        previousSessions.map((session) =>
          session.id === activeId
            ? { ...session, personaId: targetPersonaId }
            : session
        )
      )
      updateConfig('personaId', targetPersonaId)
    },
    [updateConfig]
  )

  const selectChat = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((item) => item.id === sessionId)
      if (!session) {
        return
      }

      detailLoadRequestRef.current++
      setActiveSessionId(sessionId)
      if (session.messagesLoaded === false) {
        void loadSessionDetail(sessionId)
      } else {
        setIsLoadingMessages(false)
      }
    },
    [loadSessionDetail, setActiveSessionId]
  )

  const loadMoreSessions = useCallback(async () => {
    if (isLoadingMoreSessions) return
    if (sessionsRef.current.length > visibleSessionLimit) {
      setVisibleSessionLimit((limit) => limit + HISTORY_PAGE_SIZE)
      return
    }
    if (!hasMoreServerSessions) return

    setIsLoadingMoreSessions(true)
    try {
      const page = await getChatConversations(
        nextHistoryPageRef.current,
        HISTORY_PAGE_SIZE
      )
      const merged = new Map(
        sessionsRef.current.map((session) => [session.id, session])
      )
      for (const summary of page.sessions) {
        const existing = merged.get(summary.id)
        if (!existing) {
          merged.set(summary.id, summary)
          continue
        }
        if (existing.messagesLoaded === false) {
          merged.set(summary.id, {
            ...summary,
            createdAt: existing.createdAt,
          })
        }
      }
      const ordered = [...merged.values()].sort(
        (left, right) =>
          getChatSessionRecencyTime(right) - getChatSessionRecencyTime(left) ||
          left.id.localeCompare(right.id)
      )
      sessionsRef.current = ordered
      setSessions(ordered)
      for (const summary of page.sessions) {
        lastSyncedSessionsRef.current.set(summary.id, {
          title: summary.title,
          updatedAt: summary.updatedAt,
          personaId: summary.personaId,
        })
      }
      nextHistoryPageRef.current = page.page + 1
      setHasMoreServerSessions(page.hasMore)
      setVisibleSessionLimit((limit) => limit + HISTORY_PAGE_SIZE)
    } catch (error) {
      handleServerError(error)
    } finally {
      setIsLoadingMoreSessions(false)
    }
  }, [hasMoreServerSessions, isLoadingMoreSessions, visibleSessionLimit])

  const renameChat = useCallback((sessionId: string, title: string) => {
    const nextTitle = title.trim()
    if (!nextTitle) return

    setSessions((previousSessions) =>
      previousSessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              title: nextTitle,
            }
          : session
      )
    )
  }, [])

  const deleteChat = useCallback(
    (sessionId: string) => {
      lastSyncedSessionsRef.current.delete(sessionId)
      setSessions((previousSessions) =>
        previousSessions.filter((session) => session.id !== sessionId)
      )
      if (activeSessionIdRef.current === sessionId) {
        createNewChat()
      }
      void deleteChatConversation(sessionId).catch((error: unknown) => {
        handleServerError(error)
      })
    },
    [createNewChat]
  )

  const importConversations = useCallback(
    (importedSessions: ImportedChatSession[], personaId: number) => {
      if (importedSessions.length === 0) return null

      const merged = new Map(
        sessionsRef.current.map((session) => [session.id, session])
      )
      let newestImported: ChatSession | null = null
      for (const imported of importedSessions) {
        const existing = merged.get(imported.id)
        const session: ChatSession = {
          ...imported,
          personaId: existing?.personaId ?? personaId,
          messagesLoaded: true,
        }
        merged.set(session.id, session)
        if (
          !newestImported ||
          getChatSessionRecencyTime(session) >
            getChatSessionRecencyTime(newestImported)
        ) {
          newestImported = session
        }
      }

      const ordered = [...merged.values()].sort(
        (left, right) =>
          getChatSessionRecencyTime(right) - getChatSessionRecencyTime(left) ||
          left.id.localeCompare(right.id)
      )
      sessionsRef.current = ordered
      setSessions(ordered)
      if (newestImported) {
        setActiveSessionId(newestImported.id)
      }
      return newestImported?.id ?? null
    },
    [setActiveSessionId]
  )

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG)
    setParameterEnabled(DEFAULT_PARAMETER_ENABLED)
    saveConfig(DEFAULT_CONFIG)
    saveParameterEnabled(DEFAULT_PARAMETER_ENABLED)
  }, [])

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? null
  const visibleSessions = sessions.slice(0, visibleSessionLimit)
  if (
    activeSession &&
    !visibleSessions.some((session) => session.id === activeSession.id)
  ) {
    visibleSessions.unshift(activeSession)
  }
  const hasMoreSessions =
    visibleSessionLimit < sessions.length || hasMoreServerSessions

  return {
    config,
    parameterEnabled,
    messages: activeSession?.messages ?? EMPTY_MESSAGES,
    activeSession,
    sessions,
    visibleSessions,
    isLoadingMessages,
    hasMoreSessions,
    isLoadingMoreSessions,
    models,
    groups,
    setModels,
    setGroups,
    updateConfig,
    updateParameterEnabled,
    updateMessages,
    ensureActiveSessionId,
    createNewChat,
    selectChat,
    loadMoreSessions,
    renameChat,
    deleteChat,
    importConversations,
    selectPersona,
    resetConfig,
  }
}
