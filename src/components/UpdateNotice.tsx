import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { updates } from '../updates'

/**
 * Offers the newer build when something holds the tab on this one (a call, a file transfer, a changed field). Left
 * alone, the tab still moves over by itself once nothing holds it.
 */
export function UpdateNotice() {
  const { tr } = useI18n()
  const [ready, setReady] = useState(false)
  useEffect(() => updates.onNewVersion(() => setReady(true)), [])
  if (!ready) return null
  return (
    <div className="toast toast-end toast-top z-50" data-testid="update-notice">
      <div className="alert alert-info shadow-lg" role="status" aria-live="polite">
        <span>{tr('A new version of Peerly is ready.')}</span>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>{tr('Refresh')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReady(false)}>{tr('Later')}</button>
      </div>
    </div>
  )
}
