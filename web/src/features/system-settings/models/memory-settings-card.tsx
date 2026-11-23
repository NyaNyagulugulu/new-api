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
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const schema = z.object({
  'memory_setting.enabled': z.boolean(),
  'memory_setting.auto_extract': z.boolean(),
  'memory_setting.extract_every_rounds': z.coerce
    .number()
    .int()
    .min(1)
    .max(100),
  'memory_setting.extract_window_messages': z.coerce
    .number()
    .int()
    .min(2)
    .max(200),
  'memory_setting.retrieve_limit': z.coerce.number().int().min(0).max(50),
  'memory_setting.max_injected_chars': z.coerce
    .number()
    .int()
    .min(200)
    .max(20_000),
  'memory_setting.min_importance': z.coerce.number().min(0).max(1),
  'memory_setting.retention_days': z.coerce.number().int().min(1).max(3_650),
})

export type MemorySettingsValues = z.output<typeof schema>
type MemorySettingsInput = z.input<typeof schema>

export function MemorySettingsCard(props: {
  defaultValues: MemorySettingsValues
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<MemorySettingsInput, unknown, MemorySettingsValues>({
    resolver: zodResolver(schema),
    defaultValues: props.defaultValues as MemorySettingsInput,
  })

  useEffect(() => {
    form.reset(props.defaultValues as MemorySettingsInput)
  }, [form, props.defaultValues])

  const onSubmit = async (values: MemorySettingsValues) => {
    const updates = Object.entries(values).filter(
      ([key, value]) =>
        value !== props.defaultValues[key as keyof MemorySettingsValues]
    )
    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    for (const [key, value] of updates) {
      await updateOption.mutateAsync({ key, value })
    }
  }

  return (
    <SettingsSection title={t('Long-term Memory')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />

          <FormField
            control={form.control}
            name='memory_setting.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enabled')}</FormLabel>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='memory_setting.auto_extract'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Auto extract')}</FormLabel>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <Separator />

          {(
            [
              'memory_setting.extract_every_rounds',
              'memory_setting.extract_window_messages',
              'memory_setting.retrieve_limit',
              'memory_setting.max_injected_chars',
              'memory_setting.min_importance',
              'memory_setting.retention_days',
            ] as const
          ).map((name) => (
            <FormField
              control={form.control}
              key={name}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t(
                      {
                        'memory_setting.extract_every_rounds':
                          'Extraction interval',
                        'memory_setting.extract_window_messages':
                          'Extraction window',
                        'memory_setting.retrieve_limit': 'Retrieve limit',
                        'memory_setting.max_injected_chars':
                          'Max injected characters',
                        'memory_setting.min_importance': 'Minimum importance',
                        'memory_setting.retention_days': 'Retention days',
                      }[name]
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input
                      min={0}
                      onChange={(event) => field.onChange(event.target.value)}
                      step={name === 'memory_setting.min_importance' ? 0.05 : 1}
                      type='number'
                      value={field.value}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
