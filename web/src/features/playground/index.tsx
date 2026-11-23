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
import { ArrowLeftIcon, PanelLeftIcon, SquarePenIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useSidebar } from '@/components/ui/sidebar'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundHistorySidebar } from './components/history/playground-history-sidebar'
import { PlaygroundInput } from './components/input/playground-input'
import {
  useChatHandler,
  usePlaygroundConversation,
  usePlaygroundOptions,
  usePlaygroundState,
} from './hooks'
import { getChatSessionTitle } from './lib'

export function Playground() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const router = useRouter()
  const [historyOpen, setHistoryOpen] = useState(false)
  const { open: sidebarOpen, setOpen, setOpenMobile } = useSidebar()
  const initialSidebarOpenRef = useRef(sidebarOpen)

  useEffect(() => {
    const shouldRestore = initialSidebarOpenRef.current
    setOpen(false)
    setOpenMobile(false)

    return () => {
      if (shouldRestore) setOpen(true)
    }
  }, [setOpen, setOpenMobile])

  const {
    config,
    parameterEnabled,
    messages,
    activeSession,
    sessions,
    isLoadingMessages,
    models,
    groups,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    updateParameterEnabled,
    createNewChat,
    selectChat,
    renameChat,
    deleteChat,
  } = usePlaygroundState()

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
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
    sendChat,
  })

  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })

  const closeEditorAndRun = (action: () => void) => {
    handleEditOpenChange(false)
    action()
    setHistoryOpen(false)
  }

  const handleNewChat = () => {
    closeEditorAndRun(createNewChat)
  }

  const handleSelectChat = (sessionId: string) => {
    closeEditorAndRun(() => selectChat(sessionId))
  }

  const chatTitle = activeSession
    ? getChatSessionTitle(activeSession, t('New chat'))
    : t('New chat')

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
      disabled={isGenerating}
      onDeleteChat={(sessionId) => {
        closeEditorAndRun(() => deleteChat(sessionId))
      }}
      onNewChat={handleNewChat}
      onRenameChat={renameChat}
      onSelectChat={handleSelectChat}
      sessions={sessions}
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
            aria-label={t('New chat')}
            className='lg:hidden'
            disabled={isGenerating}
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
            isGenerating={isGenerating}
            isLoadingMessages={isLoadingMessages}
            messages={messages}
            onCancelEdit={handleEditOpenChange}
            onDeleteMessage={handleDeleteMessage}
            onEditMessage={handleEditMessage}
            onRegenerateMessage={handleRegenerateMessage}
            onSaveEdit={(newContent) => applyEdit(newContent, false)}
            onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
            onSelectPrompt={handleSendMessage}
          />
        </div>

        <div className='mx-auto w-full max-w-3xl px-2 pb-2 sm:px-4'>
          <PlaygroundInput
            config={config}
            disabled={isGenerating}
            groupValue={config.group}
            groups={groups}
            isGenerating={isGenerating}
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
            onStop={stopGeneration}
            onSubmit={handleSendMessage}
            parameterEnabled={parameterEnabled}
          />
          <p className='text-muted-foreground pb-1 text-center text-[11px] leading-4'>
            {t('AI can make mistakes. Check important information.')}
          </p>
        </div>
      </section>
    </div>
  )
}
