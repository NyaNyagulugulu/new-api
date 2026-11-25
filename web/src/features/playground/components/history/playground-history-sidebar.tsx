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
import {
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  Loader2Icon,
  PencilIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  getChatSessionTitle,
  groupChatSessionsByDate,
  type ChatSessionDateGroup,
} from '../../lib'
import type { ChatSession } from '../../types'
import { PlaygroundSettingsDialog } from '../settings/playground-settings-dialog'

type PlaygroundHistorySidebarProps = {
  sessions: ChatSession[]
  activeSessionId: string | null
  disabled?: boolean
  generatingSessionIds?: ReadonlySet<string>
  unreadSessionIds?: ReadonlySet<string>
  className?: string
  onNewChat: () => void
  onSelectChat: (sessionId: string) => void
  onRenameChat: (sessionId: string, title: string) => void
  onDeleteChat: (sessionId: string) => void
}

const GROUP_LABEL_KEYS: Record<ChatSessionDateGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7Days: 'Previous 7 days',
  older: 'Older',
}

export function PlaygroundHistorySidebar(props: PlaygroundHistorySidebarProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [renameTarget, setRenameTarget] = useState<ChatSession | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const fallbackTitle = t('New chat')
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    const visibleSessions = props.sessions.filter(
      (session) => session.messages.length > 0
    )
    if (!query) return visibleSessions

    return visibleSessions.filter((session) =>
      getChatSessionTitle(session, fallbackTitle)
        .toLocaleLowerCase()
        .includes(query)
    )
  }, [fallbackTitle, props.sessions, searchQuery])
  const sessionGroups = useMemo(
    () => groupChatSessionsByDate(filteredSessions),
    [filteredSessions]
  )

  const openRenameDialog = (session: ChatSession) => {
    setRenameTarget(session)
    setRenameValue(getChatSessionTitle(session, fallbackTitle))
  }

  const handleRename = () => {
    if (!renameTarget || !renameValue.trim()) return

    props.onRenameChat(renameTarget.id, renameValue)
    setRenameTarget(null)
    toast.success(t('Chat renamed'))
  }

  const handleDelete = () => {
    if (!deleteTarget) return

    props.onDeleteChat(deleteTarget.id)
    setDeleteTarget(null)
    toast.success(t('Chat deleted'))
  }

  return (
    <aside
      aria-label={t('Chat history')}
      className={cn(
        'bg-muted/20 flex min-h-0 w-64 shrink-0 flex-col border-r',
        props.className
      )}
    >
      <div className='grid gap-2 p-3'>
        <Button
          className='h-9 justify-start rounded-xl px-3 shadow-xs'
          onClick={props.onNewChat}
          type='button'
          variant='outline'
        >
          <SquarePenIcon />
          <span>{t('New chat')}</span>
        </Button>

        <div className='relative'>
          <SearchIcon
            aria-hidden='true'
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2'
          />
          <Input
            aria-label={t('Search chats')}
            className='bg-background/70 h-8 rounded-lg pl-8 text-xs'
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('Search chats')}
            value={searchQuery}
          />
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3'>
        {sessionGroups.length === 0 ? (
          <EmptyState
            className='min-h-0 px-3 py-10'
            description={
              searchQuery ? t('Try a different search term.') : undefined
            }
            icon={MessageSquarePlusIcon}
            title={searchQuery ? t('No chats found') : t('No chats yet')}
          />
        ) : (
          <div className='grid gap-4 p-1'>
            {sessionGroups.map((group) => (
              <section className='grid gap-1' key={group.key}>
                <h2 className='text-muted-foreground px-2 py-1 text-[11px] font-medium'>
                  {t(GROUP_LABEL_KEYS[group.key])}
                </h2>
                {group.sessions.map((session) => {
                  const isActive = session.id === props.activeSessionId
                  const isGenerating = props.generatingSessionIds?.has(
                    session.id
                  )
                  const isUnread = props.unreadSessionIds?.has(session.id)
                  const title = getChatSessionTitle(session, fallbackTitle)

                  return (
                    <div className='group/chat-row relative' key={session.id}>
                      <Button
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'h-9 w-full justify-start rounded-lg px-2.5 pr-14 text-left text-sm font-normal',
                          isActive &&
                            'bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent'
                        )}
                        onClick={() => props.onSelectChat(session.id)}
                        type='button'
                        variant='ghost'
                      >
                        <span className='truncate'>{title}</span>
                      </Button>

                      {isGenerating ? (
                        <Loader2Icon
                          aria-label={t('Generating')}
                          className='text-muted-foreground absolute top-1/2 right-8 size-3.5 -translate-y-1/2 animate-spin'
                        />
                      ) : (
                        isUnread && (
                          <span
                            aria-label={t('Unread')}
                            className='bg-primary absolute top-1/2 right-8 size-2 -translate-y-1/2 rounded-full'
                          />
                        )
                      )}

                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              aria-label={`${t('Chat options')}: ${title}`}
                              className='absolute top-1/2 right-1 size-7 -translate-y-1/2 opacity-0 group-hover/chat-row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100'
                              disabled={props.disabled || isGenerating}
                              size='icon-sm'
                              type='button'
                              variant='ghost'
                            />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end' side='bottom'>
                          <DropdownMenuItem
                            disabled={props.disabled || isGenerating}
                            onClick={() => openRenameDialog(session)}
                          >
                            <PencilIcon />
                            {t('Rename')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={props.disabled || isGenerating}
                            onClick={() => setDeleteTarget(session)}
                            variant='destructive'
                          >
                            <Trash2Icon />
                            {t('Delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )
                })}
              </section>
            ))}
          </div>
        )}
      </div>

      <div className='border-t p-3'>
        <Button
          className='h-9 w-full justify-start rounded-lg px-2.5 text-sm font-normal'
          onClick={() => setSettingsOpen(true)}
          type='button'
          variant='ghost'
        >
          <SettingsIcon />
          <span>{t('Settings')}</span>
        </Button>
      </div>

      <PlaygroundSettingsDialog
        onOpenChange={setSettingsOpen}
        open={settingsOpen}
      />

      <Dialog
        footer={
          <>
            <Button
              onClick={() => setRenameTarget(null)}
              type='button'
              variant='outline'
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={!renameValue.trim()}
              onClick={handleRename}
              type='button'
            >
              {t('Save')}
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        open={Boolean(renameTarget)}
        title={t('Rename chat')}
      >
        <Input
          aria-label={t('Chat title')}
          autoFocus
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleRename()
            }
          }}
          value={renameValue}
        />
      </Dialog>

      <ConfirmDialog
        destructive
        desc={t(
          'This chat will be permanently deleted. This cannot be undone.'
        )}
        confirmText={t('Delete')}
        handleConfirm={handleDelete}
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('Delete chat?')}
      />
    </aside>
  )
}
