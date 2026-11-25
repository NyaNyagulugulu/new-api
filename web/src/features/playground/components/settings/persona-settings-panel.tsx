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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PencilIcon, PlusIcon, Trash2Icon, UserRoundIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import {
  createUserPersona,
  deleteUserPersona,
  updateUserPersona,
} from '../../api'
import { PERSONA_QUERY_KEY, usePersonas } from '../../hooks/use-personas'
import type { UserPersona } from '../../types'

type PersonaDraft = {
  name: string
  traits: string
}

const EMPTY_DRAFT: PersonaDraft = { name: '', traits: '' }

export function PersonaSettingsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const personasQuery = usePersonas()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPersona, setEditingPersona] = useState<UserPersona | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserPersona | null>(null)
  const [draft, setDraft] = useState<PersonaDraft>(EMPTY_DRAFT)
  const personas = personasQuery.data ?? []
  const customPersonas = personas.filter((persona) => persona.id !== 0)
  let personaList: React.ReactNode = null
  if (!personasQuery.isPending && customPersonas.length === 0) {
    personaList = (
      <EmptyState
        className='min-h-40'
        description={t(
          'Create a persona to give WebChat a different character and separate memory.'
        )}
        icon={UserRoundIcon}
        title={t('No custom personas yet')}
      />
    )
  } else if (customPersonas.length > 0) {
    personaList = customPersonas.map((persona) => (
      <article
        className='bg-background/60 rounded-xl border p-3'
        key={persona.id}
      >
        <div className='flex items-start gap-3'>
          <div className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg'>
            <UserRoundIcon className='text-muted-foreground size-4' />
          </div>
          <div className='min-w-0 flex-1'>
            <h3 className='truncate text-sm font-medium'>{persona.name}</h3>
            <p className='text-muted-foreground mt-1 line-clamp-2 text-xs leading-5 break-words whitespace-pre-wrap'>
              {persona.traits || t('No traits entered.')}
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            <Button
              aria-label={`${t('Edit persona')}: ${persona.name}`}
              onClick={() => openEdit(persona)}
              size='icon-sm'
              type='button'
              variant='ghost'
            >
              <PencilIcon className='size-3.5' />
            </Button>
            <Button
              aria-label={`${t('Delete persona')}: ${persona.name}`}
              onClick={() => setDeleteTarget(persona)}
              size='icon-sm'
              type='button'
              variant='ghost'
            >
              <Trash2Icon className='text-destructive size-3.5' />
            </Button>
          </div>
        </div>
      </article>
    ))
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim()) {
        throw new Error(t('Name is required'))
      }
      if (editingPersona) {
        await updateUserPersona(editingPersona.id, draft)
      } else {
        await createUserPersona(draft)
      }
    },
    onSuccess: () => {
      toast.success(t('Persona saved'))
      setEditorOpen(false)
      setEditingPersona(null)
      setDraft(EMPTY_DRAFT)
      void queryClient.invalidateQueries({ queryKey: PERSONA_QUERY_KEY })
    },
    onError: (error) => {
      handleServerError(error, t('Failed to save persona'))
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteUserPersona(id),
    onSuccess: () => {
      toast.success(t('Persona deleted'))
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: PERSONA_QUERY_KEY })
    },
    onError: (error) => {
      handleServerError(error, t('Failed to delete persona'))
    },
  })

  const openCreate = () => {
    setEditingPersona(null)
    setDraft(EMPTY_DRAFT)
    setEditorOpen(true)
  }

  const openEdit = (persona: UserPersona) => {
    setEditingPersona(persona)
    setDraft({ name: persona.name, traits: persona.traits })
    setEditorOpen(true)
  }

  return (
    <>
      <section className='space-y-4'>
        <div className='flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between'>
          <div className='flex min-w-0 gap-3'>
            <div className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg'>
              <UserRoundIcon className='size-4' aria-hidden='true' />
            </div>
            <div className='min-w-0'>
              <h2 className='text-sm font-semibold'>{t('Persona settings')}</h2>
              <p className='text-muted-foreground mt-1 text-xs leading-5'>
                {t(
                  'Create different characters for WebChat. Each persona keeps its own long-term memory.'
                )}
              </p>
            </div>
          </div>
          <Button onClick={openCreate} type='button'>
            <PlusIcon />
            {t('New persona')}
          </Button>
        </div>

        <div className='grid gap-2'>
          <article className='bg-background/60 rounded-xl border p-3'>
            <div className='flex items-start gap-3'>
              <div className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg'>
                <UserRoundIcon className='text-muted-foreground size-4' />
              </div>
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <h3 className='text-sm font-medium'>
                    {t('Default persona')}
                  </h3>
                  <span className='bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[11px]'>
                    {t('Built in')}
                  </span>
                </div>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t('An empty persona with no name or traits.')}
                </p>
              </div>
            </div>
          </article>

          {personaList}
        </div>
      </section>

      <Dialog
        contentClassName='sm:max-w-xl'
        footer={
          <>
            <Button
              onClick={() => setEditorOpen(false)}
              type='button'
              variant='outline'
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={!draft.name.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              type='button'
            >
              {t('Save')}
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open) {
            setEditorOpen(false)
            setEditingPersona(null)
            setDraft(EMPTY_DRAFT)
          }
        }}
        open={editorOpen}
        title={editingPersona ? t('Edit persona') : t('New persona')}
      >
        <div className='grid gap-4'>
          <div className='grid gap-2'>
            <Label htmlFor='persona-name'>{t('Character name')}</Label>
            <Input
              id='persona-name'
              maxLength={80}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder={t('For example: Luna')}
              value={draft.name}
            />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='persona-traits'>{t('Character traits')}</Label>
            <Textarea
              className='min-h-32'
              id='persona-traits'
              maxLength={4000}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  traits: event.target.value,
                }))
              }
              placeholder={t(
                'Describe the character, personality, background, speaking style, and boundaries.'
              )}
              value={draft.traits}
            />
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        destructive
        desc={t(
          'Deleting this persona also deletes its long-term memories and resets its conversations to the default persona. This cannot be undone.'
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
        title={t('Delete persona?')}
      />
    </>
  )
}
