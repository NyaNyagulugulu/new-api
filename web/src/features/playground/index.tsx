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
import { useNavigate, useRouter } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  PanelLeftIcon,
  SquarePenIcon,
  UploadIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundHistorySidebar } from './components/history/playground-history-sidebar'
import { PlaygroundImportDialog } from './components/history/playground-import-dialog'
import { PlaygroundInput } from './components/input/playground-input'
import {
  useChatHandler,
  useAiChatTitles,
  useLongTermMemoryReflection,
  useMemorySettings,
  usePersonas,
  usePlaygroundConversation,
  usePlaygroundOptions,
  usePlaygroundState,
} from './hooks'
import {
  createCompletionSoundPlayer,
  getChatSessionTitle,
  mergeMessageUsageByKey,
  type CompletionSoundPlayer,
} from './lib'
import type {
  ChatImportResult,
  Message,
  MessageAttachment,
  MessageUsage,
} from './types'

type PlaygroundProps = {
  conversationId?: string
}

export function Playground(props: PlaygroundProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const router = useRouter()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [unreadSessionIds, setUnreadSessionIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const completionSoundRef = useRef<CompletionSoundPlayer | null>(null)
  const previousGeneratingSessionIdsRef = useRef<ReadonlySet<string>>(new Set())
  const suppressedCompletionSessionsRef = useRef<ReadonlySet<string>>(new Set())

  if (!completionSoundRef.current) {
    completionSoundRef.current = createCompletionSoundPlayer()
  }

  const {
    config,
    parameterEnabled,
    messages,
    activeSession,
    sessions,
    visibleSessions,
    isLoadingMessages,
    hasMoreSessions,
    isLoadingMoreSessions,
    models,
    groups,
    updateMessages,
    ensureActiveSessionId,
    setModels,
    setGroups,
    updateConfig,
    updateParameterEnabled,
    createNewChat,
    selectChat,
    loadMoreSessions,
    renameChat,
    deleteChat,
    importConversations,
    selectPersona,
  } = usePlaygroundState(props.conversationId ?? null)
  const handleMemoryUsage = useCallback(
    (sessionId: string, messageKey: string, usage: MessageUsage) => {
      updateMessages(
        (previousMessages) =>
          mergeMessageUsageByKey(previousMessages, messageKey, usage),
        sessionId
      )
    },
    [updateMessages]
  )
  const { models: pricingModels } = usePricingData()
  const memorySettings = useMemorySettings()
  const { data: personas = [] } = usePersonas()
  const activePersonaId = activeSession?.personaId ?? config.personaId ?? 0
  const activePersona = personas.find(
    (persona) => persona.id === activePersonaId
  )

  const { sendChat, stopGeneration, generatingSessionIds } = useChatHandler({
    config,
    contextWindowTokens: pricingModels.find(
      (model) => model.key === config.model
    )?.context_length,
    memorySettings,
    parameterEnabled,
    persona: activePersona,
    personaId: activePersonaId,
    onMessageUpdate: updateMessages,
  })

  const {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  } = usePlaygroundConversation({
    messages,
    updateMessages,
    ensureActiveSessionId,
    sendChat,
  })

  useLongTermMemoryReflection({
    config,
    isLoadingMessages,
    onUsage: handleMemoryUsage,
    sessions,
    settings: memorySettings,
  })

  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })

  useAiChatTitles({
    config,
    isLoadingMessages,
    renameChat,
    sessions,
  })

  useEffect(() => {
    if (personas.length === 0 || activePersonaId === 0) return
    if (personas.some((persona) => persona.id === activePersonaId)) return
    selectPersona(0)
  }, [activePersonaId, personas, selectPersona])

  useEffect(() => {
    if (props.conversationId || isLoadingMessages) return

    const sessionId = activeSession?.id ?? ensureActiveSessionId()
    void navigate({
      to: '/c/$conversationId',
      params: { conversationId: sessionId },
      replace: true,
    })
  }, [
    activeSession?.id,
    ensureActiveSessionId,
    isLoadingMessages,
    navigate,
    props.conversationId,
  ])

  useEffect(
    () => () => {
      completionSoundRef.current?.dispose()
    },
    []
  )

  useEffect(() => {
    const previous = previousGeneratingSessionIdsRef.current
    previousGeneratingSessionIdsRef.current = generatingSessionIds
    const completedSessionIds = [...previous].filter(
      (sessionId) => !generatingSessionIds.has(sessionId)
    )
    if (completedSessionIds.length === 0) return

    const suppressed = suppressedCompletionSessionsRef.current
    if (suppressed.size > 0) {
      const nextSuppressed = new Set(suppressed)
      for (const sessionId of completedSessionIds) {
        nextSuppressed.delete(sessionId)
      }
      suppressedCompletionSessionsRef.current = nextSuppressed
    }

    const notifySessionIds = completedSessionIds.filter(
      (sessionId) =>
        sessionId !== activeSession?.id && !suppressed.has(sessionId)
    )
    if (notifySessionIds.length === 0) return

    setUnreadSessionIds((current) => {
      const next = new Set(current)
      for (const sessionId of notifySessionIds) {
        next.add(sessionId)
      }
      return next
    })
    completionSoundRef.current?.play()
  }, [activeSession?.id, generatingSessionIds])

  const closeEditorAndRun = (action: () => void) => {
    handleEditOpenChange(false)
    action()
    setHistoryOpen(false)
  }

  const handleNewChat = () => {
    closeEditorAndRun(() => {
      createNewChat()
      const sessionId = ensureActiveSessionId()
      void navigate({
        to: '/c/$conversationId',
        params: { conversationId: sessionId },
      })
    })
  }

  const handleSelectChat = (sessionId: string) => {
    setUnreadSessionIds((current) => {
      if (!current.has(sessionId)) return current
      const next = new Set(current)
      next.delete(sessionId)
      return next
    })
    closeEditorAndRun(() => selectChat(sessionId))
    void navigate({
      to: '/c/$conversationId',
      params: { conversationId: sessionId },
    })
  }

  const handleImported = (result: ChatImportResult) => {
    const sessionId = importConversations(result.sessions, activePersonaId)
    if (!sessionId) return
    void navigate({
      to: '/c/$conversationId',
      params: { conversationId: sessionId },
    })
  }

  const handleSendWithSound = (
    text: string,
    attachments?: MessageAttachment[]
  ) => {
    completionSoundRef.current?.unlock()
    handleSendMessage(text, attachments)
  }

  const handleRegenerateWithSound = (message: Message) => {
    completionSoundRef.current?.unlock()
    handleRegenerateMessage(message)
  }

  const handleStopGeneration = () => {
    const sessionId = activeSession?.id
    if (!sessionId) return
    suppressedCompletionSessionsRef.current = new Set(
      suppressedCompletionSessionsRef.current
    ).add(sessionId)
    stopGeneration(sessionId)
  }

  const chatTitle = activeSession
    ? getChatSessionTitle(activeSession, t('New chat'))
    : t('New chat')
  const isCurrentSessionGenerating = Boolean(
    activeSession?.id && generatingSessionIds.has(activeSession.id)
  )
  const isActiveSessionReady = activeSession?.messagesLoaded !== false

  const handleBack = () => {
    if (router.history.canGoBack()) {
      router.history.back()
      return
    }

    void navigate({ to: '/dashboard' })
  }

  const historySidebar = (className: string) => (
    <PlaygroundHistorySidebar
      activeSessionId={activeSession?.id ?? null}
      className={className}
      generatingSessionIds={generatingSessionIds}
      hasMore={hasMoreSessions}
      isLoadingMore={isLoadingMoreSessions}
      onDeleteChat={(sessionId) => {
        if (generatingSessionIds.has(sessionId)) {
          suppressedCompletionSessionsRef.current = new Set(
            suppressedCompletionSessionsRef.current
          ).add(sessionId)
          stopGeneration(sessionId)
        }
        closeEditorAndRun(() => deleteChat(sessionId))
      }}
      onNewChat={handleNewChat}
      onLoadMore={loadMoreSessions}
      onRenameChat={renameChat}
      onSelectChat={handleSelectChat}
      sessions={visibleSessions}
      unreadSessionIds={unreadSessionIds}
    />
  )

  return (
    <div className='bg-background flex size-full min-h-0 overflow-hidden'>
      {historySidebar('hidden lg:flex')}

      <Sheet onOpenChange={setHistoryOpen} open={historyOpen}>
        <SheetContent className='w-[19rem] max-w-[85vw] p-0' side='left'>
          <SheetHeader className='border-b px-4 py-3 pr-12'>
            <SheetTitle>{t('Chat history')}</SheetTitle>
            <SheetDescription className='sr-only'>
              {t('Chat history')}
            </SheetDescription>
          </SheetHeader>
          {historySidebar('flex w-full border-r-0')}
        </SheetContent>
      </Sheet>

      <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <header className='flex h-12 shrink-0 items-center gap-2 border-b px-2.5'>
          <Button
            aria-label={t('Back')}
            onClick={handleBack}
            size='icon-sm'
            type='button'
            variant='ghost'
          >
            <ArrowLeftIcon />
          </Button>

          <Button
            aria-label={t('Open chat history')}
            className='lg:hidden'
            onClick={() => setHistoryOpen(true)}
            size='icon-sm'
            type='button'
            variant='ghost'
          >
            <PanelLeftIcon />
          </Button>

          <h1 className='min-w-0 flex-1 truncate px-1 text-sm font-medium'>
            {chatTitle}
          </h1>

          <Button
            aria-label={t('Import conversations')}
            onClick={() => setImportOpen(true)}
            size='sm'
            type='button'
            variant='outline'
          >
            <UploadIcon />
            <span className='hidden sm:inline'>
              {t('Import conversations')}
            </span>
          </Button>

          <Button
            aria-label={t('New chat')}
            className='lg:hidden'
            onClick={handleNewChat}
            size='icon-sm'
            type='button'
            variant='ghost'
          >
            <SquarePenIcon />
          </Button>
        </header>

        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <PlaygroundChat
            editingKey={editingMessageKey}
            isGenerating={isCurrentSessionGenerating}
            isLoadingMessages={isLoadingMessages}
            messages={messages}
            onCancelEdit={handleEditOpenChange}
            onDeleteMessage={handleDeleteMessage}
            onEditMessage={handleEditMessage}
            onRegenerateMessage={handleRegenerateWithSound}
            onSaveEdit={(newContent) => applyEdit(newContent, false)}
            onSaveEditAndSubmit={(newContent) => {
              completionSoundRef.current?.unlock()
              applyEdit(newContent, true)
            }}
            onSelectPrompt={handleSendWithSound}
          />
        </div>

        <div className='mx-auto w-full max-w-3xl px-2 pb-2 sm:px-4'>
          <PlaygroundInput
            config={config}
            disabled={
              isCurrentSessionGenerating ||
              isLoadingMessages ||
              !isActiveSessionReady
            }
            groupValue={config.group}
            groups={groups}
            isGenerating={isCurrentSessionGenerating}
            isModelLoading={isLoadingModels}
            modelValue={config.model}
            models={models}
            onConfigChange={updateConfig}
            onGroupChange={(value) => updateConfig('group', value)}
            onModelChange={(value) => updateConfig('model', value)}
            onParameterEnabledChange={updateParameterEnabled}
            onReasoningEffortChange={(value) =>
              updateConfig('reasoningEffort', value)
            }
            onPersonaChange={selectPersona}
            onStop={handleStopGeneration}
            onSubmit={handleSendWithSound}
            parameterEnabled={parameterEnabled}
            personaId={activePersonaId}
            personas={personas}
          />
          <p className='text-muted-foreground pb-1 text-center text-[11px] leading-4'>
            {t('AI can make mistakes. Check important information.')}
          </p>
        </div>
      </section>

      <PlaygroundImportDialog
        onImported={handleImported}
        onOpenChange={setImportOpen}
        open={importOpen}
      />
    </div>
  )
}
