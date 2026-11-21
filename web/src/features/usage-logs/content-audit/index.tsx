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
import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { useAuthStore } from '@/stores/auth-store'

import { ContentAuditViewer } from './components/content-audit-viewer'

export function ContentAuditLogs() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const canRead = hasPermission(
    user,
    ADMIN_PERMISSION_RESOURCES.CONTENT_AUDIT,
    ADMIN_PERMISSION_ACTIONS.READ
  )
  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Content Audit')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-3'>
          {canRead ? (
            <>
              <Alert className='shrink-0'>
                <AlertDescription>
                  {t(
                    'Relay requests and responses are retained for 30 days for illegal-content traceability. Embedding requests are excluded.'
                  )}
                </AlertDescription>
              </Alert>
              <div className='min-h-0 flex-1'>
                <ContentAuditViewer enabled />
              </div>
            </>
          ) : (
            <Alert variant='destructive'>
              <ShieldAlert />
              <AlertTitle>{t('Access denied')}</AlertTitle>
              <AlertDescription>
                {t(
                  'You do not have permission to view retained relay content.'
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
