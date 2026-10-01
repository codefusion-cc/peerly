import { WifiOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useI18n } from '../i18nContext.ts'

const subscribe = (listener: () => void) => {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => { window.removeEventListener('online', listener); window.removeEventListener('offline', listener) }
}

/** A thin bar while the browser is offline: what is written waits, nothing is lost. */
export function OfflineNotice() {
  const { t } = useI18n()
  const online = useSyncExternalStore(subscribe, () => navigator.onLine)
  if (online) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-sm text-warning-content">
      <WifiOff className="size-4" aria-hidden="true" />{t.offline}
    </div>
  )
}
