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
import { useMutation } from '@tanstack/react-query'
import { FileArchiveIcon, LinkIcon, UploadIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { handleServerError } from '@/lib/handle-server-error'

import { importChatConversations } from '../../api'
import type { ChatImportResult } from '../../types'

type PlaygroundImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (result: ChatImportResult) => void
}

type ImportMode = 'url' | 'file'

export function PlaygroundImportDialog(props: PlaygroundImportDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<ImportMode>('url')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const importMutation = useMutation({
    mutationFn: () =>
      importChatConversations(
        mode === 'url' ? { url: url.trim() } : { file: file ?? undefined }
      ),
    onSuccess: (result) => {
      if (result.sessions.length === 0) {
        toast.error(t('No conversations were found in this import'))
        return
      }
      toast.success(
        t('Imported {{count}} conversations', { count: result.imported })
      )
      props.onImported(result)
      props.onOpenChange(false)
      setUrl('')
      setFile(null)
    },
    onError: (error) => {
      handleServerError(error, t('Failed to import conversations'))
    },
  })

  const canImport =
    !importMutation.isPending &&
    (mode === 'url' ? url.trim().length > 0 : file !== null)

  return (
    <Dialog
      contentClassName='sm:max-w-2xl'
      description={t(
        'Import conversation history from a trusted export. Imported chats use the currently selected persona.'
      )}
      footer={
        <>
          <Button
            disabled={importMutation.isPending}
            onClick={() => props.onOpenChange(false)}
            type='button'
            variant='outline'
          >
            {t('Cancel')}
          </Button>
          <Button
            disabled={!canImport}
            onClick={() => importMutation.mutate()}
            type='button'
          >
            {importMutation.isPending ? <Spinner /> : <UploadIcon />}
            {importMutation.isPending ? t('Importing...') : t('Import')}
          </Button>
        </>
      }
      onOpenChange={(open) => {
        if (!open && !importMutation.isPending) {
          props.onOpenChange(false)
        }
      }}
      open={props.open}
      title={t('Import conversations')}
    >
      <Tabs
        className='gap-4'
        onValueChange={(value) => setMode(value as ImportMode)}
        value={mode}
      >
        <TabsList className='grid w-full grid-cols-2'>
          <TabsTrigger value='url'>
            <LinkIcon />
            {t('Import from URL')}
          </TabsTrigger>
          <TabsTrigger value='file'>
            <FileArchiveIcon />
            {t('Upload file')}
          </TabsTrigger>
        </TabsList>

        <TabsContent className='space-y-3' value='url'>
          <div className='grid gap-2'>
            <Label htmlFor='chat-import-url'>{t('Export download URL')}</Label>
            <Input
              autoComplete='off'
              id='chat-import-url'
              maxLength={4096}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t('Paste a DeepSeek chat history export URL')}
              type='url'
              value={url}
            />
          </div>
          <p className='text-muted-foreground text-xs leading-5'>
            {t(
              'Supports DeepSeek ZIP or JSON exports. Only public HTTPS URLs are allowed; local and private network addresses are blocked.'
            )}
          </p>
        </TabsContent>

        <TabsContent className='space-y-3' value='file'>
          <div className='grid gap-2'>
            <Label htmlFor='chat-import-file'>
              {t('Conversation export file')}
            </Label>
            <Input
              accept='.zip,.json,application/zip,application/json'
              className='cursor-pointer'
              id='chat-import-file'
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              type='file'
            />
          </div>
          <p className='text-muted-foreground text-xs leading-5'>
            {t(
              'Choose a DeepSeek ZIP export or a JSON conversation export. The file is parsed on the server and is not executed.'
            )}
          </p>
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}
