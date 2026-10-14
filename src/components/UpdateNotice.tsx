import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { updates } from '../updates'

/** The build this tab was told to leave for later; a notice mounted again on another screen stays hidden for it. */
let dismissed: string | null = null

/**
 * Offers the newer build when something holds the tab on this one (a call, a file transfer, a changed field). Left
 * alone, the tab still moves over by itself once nothing holds it. An alert for the app's toast stack.
 */
export function UpdateNotice() {
  const { tr } = useI18n()
  const [commit, setCommit] = useState<string | null>(null)
  useEffect(() => updates.onNewVersion(next => setCommit(next === dismissed ? null : next)), [])
  if (!commit) return null
  return (
    <div className="alert alert-info shadow-lg" role="status" aria-live="polite" data-testid="update-notice">
      <span>{tr('A new version of Peerly is ready.')}</span>
      <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>{tr('Refresh')}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { dismissed = commit; setCommit(null) }}>{tr('Later')}</button>
    </div>
  )
}
