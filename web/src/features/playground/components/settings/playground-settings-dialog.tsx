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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BrainIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import dayjs from '@/lib/dayjs'

import {
  deleteAllUserMemories,
  deleteUserMemory,
  getUserMemoryList,
} from '../../api'
import { usePersonas } from '../../hooks/use-personas'
import type { UserMemory } from '../../types'
import { PersonaSettingsPanel } from './persona-settings-panel'

const MEMORY_QUERY_KEY = ['playground', 'long-term-memories'] as const

type PlaygroundSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PlaygroundSettingsDialog(props: PlaygroundSettingsDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: personas = [] } = usePersonas()
  const [deleteTarget, setDeleteTarget] = useState<UserMemory | null>(null)
  const [clearAllOpen, setClearAllOpen] = useState(false)
  const memoriesQuery = useQuery({
    queryKey: MEMORY_QUERY_KEY,
    queryFn: getUserMemoryList,
    enabled: props.open,
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteUserMemory(id),
    onSuccess: () => {
      toast.success(t('Memory deleted'))
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: MEMORY_QUERY_KEY })
    },
  })
  const clearAllMutation = useMutation({
    mutationFn: deleteAllUserMemories,
    onSuccess: () => {
      toast.success(t('All memories cleared'))
      setClearAllOpen(false)
      queryClient.setQueryData(MEMORY_QUERY_KEY, [])
    },
  })

  const memories = memoriesQuery.data ?? []
  const personasById = new Map(personas.map((persona) => [persona.id, persona]))
  const isMutating = deleteMutation.isPending || clearAllMutation.isPending
  let memoryList: React.ReactNode
  if (memoriesQuery.isPending) {
    memoryList = (
      <div className='flex min-h-52 items-center justify-center'>
        <Spinner className='size-6' />
      </div>
    )
  } else if (memoriesQuery.isError) {
    memoryList = (
      <ErrorState
        className='min-h-52'
        description={t('Failed to load memories')}
        onRetry={() => void memoriesQuery.refetch()}
      />
    )
  } else if (memories.length === 0) {
    memoryList = (
      <EmptyState
        className='min-h-52'
        description={t(
          'WebChat will save useful long-term details from your conversations here.'
        )}
        icon={BrainIcon}
        title={t('No memories yet')}
      />
    )
  } else {
    memoryList = (
      <div className='grid gap-2'>
        {memories.map((memory) => (
          <article
            className='bg-background/60 rounded-xl border p-3'
            key={memory.id}
          >
            <div className='flex items-start gap-2'>
              <p className='min-w-0 flex-1 text-sm leading-6 break-words whitespace-pre-wrap'>
                {memory.content}
              </p>
              <Button
                aria-label={t('Delete memory')}
                disabled={isMutating}
                onClick={() => setDeleteTarget(memory)}
                size='icon-sm'
                type='button'
                variant='ghost'
              >
                <Trash2Icon className='text-muted-foreground size-3.5' />
              </Button>
            </div>
            <div className='text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
              {memory.category ? (
                <span className='bg-muted rounded-md px-1.5 py-0.5'>
                  {memory.category}
                </span>
              ) : null}
              <span>
                {t('Persona')}:{' '}
                {memory.persona_id === 0
                  ? t('Default persona')
                  : (personasById.get(memory.persona_id)?.name ??
                    t('Unknown persona'))}
              </span>
              <span>
                {t('Importance')}: {Math.round(memory.importance * 100)}%
              </span>
              <span>
                {t('Updated')}:{' '}
                {dayjs(memory.updated_at).format('YYYY-MM-DD HH:mm')}
              </span>
            </div>
          </article>
        ))}
      </div>
    )
  }

  return (
    <>
      <Dialog
        contentClassName='sm:max-w-3xl'
        contentHeight='clamp(22rem, 65vh, 42rem)'
        description={t('Manage WebChat personas and long-term memory.')}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setClearAllOpen(false)
          }
          props.onOpenChange(open)
        }}
        open={props.open}
        title={t('Settings')}
      >
        <Tabs className='gap-4' defaultValue='personas'>
          <TabsList className='grid w-full grid-cols-2'>
            <TabsTrigger value='personas'>{t('Persona settings')}</TabsTrigger>
            <TabsTrigger value='memory'>{t('Memory management')}</TabsTrigger>
          </TabsList>
          <TabsContent value='personas'>
            <PersonaSettingsPanel />
          </TabsContent>
          <TabsContent value='memory'>
            <section className='space-y-4'>
              <div className='flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between'>
                <div className='flex min-w-0 gap-3'>
                  <div className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg'>
                    <BrainIcon className='size-4' aria-hidden='true' />
                  </div>
                  <div className='min-w-0'>
                    <h2 className='text-sm font-semibold'>
                      {t('Memory management')}
                    </h2>
                    <p className='text-muted-foreground mt-1 text-xs leading-5'>
                      {t(
                        'WebChat can remember useful details from your conversations. Review what is stored or clear it at any time.'
                      )}
                    </p>
                  </div>
                </div>
                <Button
                  disabled={
                    memoriesQuery.isPending ||
                    memories.length === 0 ||
                    isMutating
                  }
                  onClick={() => setClearAllOpen(true)}
                  type='button'
                  variant='destructive'
                >
                  {clearAllMutation.isPending ? <Spinner /> : <Trash2Icon />}
                  {t('Clear all memories')}
                </Button>
              </div>

              {memoryList}
            </section>
          </TabsContent>
        </Tabs>
      </Dialog>

      <ConfirmDialog
        destructive
        desc={t(
          'This will permanently delete every saved memory. This cannot be undone.'
        )}
        confirmText={t('Delete')}
        handleConfirm={() => clearAllMutation.mutate()}
        isLoading={clearAllMutation.isPending}
        open={clearAllOpen}
        onOpenChange={setClearAllOpen}
        title={t('Clear all memories?')}
      />

      <ConfirmDialog
        destructive
        desc={t(
          'This memory will be permanently deleted. This cannot be undone.'
        )}
        confirmText={t('Delete')}
        handleConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
        isLoading={deleteMutation.isPending}
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('Delete memory?')}
      />
    </>
  )
}
