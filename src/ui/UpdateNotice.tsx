import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18nContext.ts'
import { updates } from '../updates.ts'

/** A newer build this tab could not move to by itself (something held it): offered, never forced. */
export function UpdateNotice() {
  const { t } = useI18n()
  const [ready, setReady] = useState(false)
  useEffect(() => updates.onNewVersion(() => setReady(true)), [])
  if (!ready) return null
  return (
    <div role="status" className="flex items-center justify-center gap-3 bg-info px-4 py-1.5 text-sm text-info-content">
      {t.updateReady}
      <button type="button" className="btn btn-xs" onClick={() => location.reload()}>
        <RefreshCw className="size-3.5" aria-hidden="true" />{t.updateReload}
      </button>
    </div>
  )
}
