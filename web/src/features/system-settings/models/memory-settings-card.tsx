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
import { useEffect, useMemo } from 'react'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'

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
  'memory_setting.embedding_enabled': z.boolean(),
  'memory_setting.embedding_model': z.string(),
  'memory_setting.embedding_group': z.string(),
  'memory_setting.min_similarity': z.coerce.number().min(0).max(1),
  'memory_setting.vector_weight': z.coerce.number().min(0).max(1),
})

export type MemorySettingsValues = z.output<typeof schema>
type MemorySettingsInput = z.input<typeof schema>

export function MemorySettingsCard(props: {
  defaultValues: MemorySettingsValues
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const { models, usableGroup } = usePricingData()
  const form = useForm<MemorySettingsInput, unknown, MemorySettingsValues>({
    resolver: zodResolver(schema),
    defaultValues: props.defaultValues as MemorySettingsInput,
  })

  useEffect(() => {
    form.reset(props.defaultValues as MemorySettingsInput)
  }, [form, props.defaultValues])

  const embeddingModels = useMemo(() => {
    const names = models
      .map((model) => model.model_name)
      .filter((name) => /embed|bge|m3/i.test(name))
    const current = props.defaultValues['memory_setting.embedding_model']
    if (current && !names.includes(current)) {
      names.unshift(current)
    }
    return [...new Set(names)].sort((left, right) => left.localeCompare(right))
  }, [models, props.defaultValues])

  const embeddingGroups = useMemo(() => {
    const groups = Object.keys(usableGroup)
    const current = props.defaultValues['memory_setting.embedding_group']
    if (current && !groups.includes(current)) {
      groups.push(current)
    }
    return groups.sort((left, right) => left.localeCompare(right))
  }, [props.defaultValues, usableGroup])

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

          <FormField
            control={form.control}
            name='memory_setting.embedding_enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Embedding enabled')}</FormLabel>
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

          <FormField
            control={form.control}
            name='memory_setting.embedding_model'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Embedding model')}</FormLabel>
                <FormControl>
                  <NativeSelect
                    className='w-full'
                    onChange={(event) => field.onChange(event.target.value)}
                    value={field.value}
                  >
                    <NativeSelectOption value=''>
                      {t('Select embedding model')}
                    </NativeSelectOption>
                    {embeddingModels.map((model) => (
                      <NativeSelectOption key={model} value={model}>
                        {model}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='memory_setting.embedding_group'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Embedding group')}</FormLabel>
                <FormControl>
                  <NativeSelect
                    className='w-full'
                    onChange={(event) => field.onChange(event.target.value)}
                    value={field.value}
                  >
                    <NativeSelectOption value=''>
                      {t('Use current chat group')}
                    </NativeSelectOption>
                    {embeddingGroups.map((group) => (
                      <NativeSelectOption key={group} value={group}>
                        {group}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {(
            [
              'memory_setting.extract_every_rounds',
              'memory_setting.extract_window_messages',
              'memory_setting.retrieve_limit',
              'memory_setting.max_injected_chars',
              'memory_setting.min_importance',
              'memory_setting.retention_days',
              'memory_setting.min_similarity',
              'memory_setting.vector_weight',
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
                        'memory_setting.min_similarity': 'Minimum similarity',
                        'memory_setting.vector_weight': 'Vector weight',
                      }[name]
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input
                      min={0}
                      onChange={(event) => field.onChange(event.target.value)}
                      step={
                        name === 'memory_setting.min_importance' ||
                        name === 'memory_setting.min_similarity' ||
                        name === 'memory_setting.vector_weight'
                          ? 0.05
                          : 1
                      }
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
