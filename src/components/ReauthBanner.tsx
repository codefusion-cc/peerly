import { useCallback, useEffect, useState } from 'react'
import { isE2eAuthBypass } from '../collab/e2eAuth'
import type { IdentityExpiryPhase } from '../collab/identityExpiry'
import { signInWithProvider } from '../collab/providerSignIn'
import { googleNoticeText, startGoogleRedirect, takeGoogleNotice } from '../auth/googleRedirect'
import { deriveUserId } from '../collab/userId'
import type { WorkspaceAuthManager } from '../collab/workspaceAuth'
import { saveIdCredentials, type Session } from '../session'
import { useI18n } from '../i18n'

type Props = {
  phase: IdentityExpiryPhase
  session: Session
  authManager: WorkspaceAuthManager | null
  /** Called after a fresh token is stored, so the expiry tracker re-reads it. */
  onReauthed: () => void
}

/**
 * The end of a sign-in, made visible. A token is accepted for 30 days
 * (auth/deviceToken); past that every NEW handshake fails (joining teammates, reconnects, your own other
 * devices) while existing connections keep working — which used to read as
 * "the app randomly broke". Existing state is untouched by re-auth: only the
 * stored token and the manager's copy are replaced.
 *
 * Re-auth must be the SAME account: the workspace admitted this email, and a
 * different one would break membership mid-session.
 */
export function ReauthBanner({ phase, session, authManager, onReauthed }: Props) {
  const { tr, locale } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const e2e = isE2eAuthBypass()
  const provider = session.identityProvider

  // What came of a renewal at Google that stored nothing.
  useEffect(() => {
    const notice = takeGoogleNotice('renew')
    if (notice) setError(googleNoticeText(notice, tr))
  }, [tr])

  // Back from Google's page by the Back button: the page comes out of the back-forward cache as it was left.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false)
    }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [])

  const completeWithToken = useCallback(
    async (token: string) => {
      if (!authManager) throw new Error(tr('Still connecting — try again in a moment'))
      const claims = await authManager.verifyAndStoreIdToken(token, provider)
      if (claims.email.toLowerCase() !== session.identityEmail.toLowerCase()) {
        // Roll back: the manager must not keep a token for a different account.
        authManager.setIdToken(null, provider)
        throw new Error(
          tr('Signed in as {actual}, but this workspace admitted {expected}. Use the same account.', {
            actual: claims.email,
            expected: session.identityEmail,
          })
        )
      }
      const userId = await deriveUserId(claims.iss, claims.sub)
      saveIdCredentials(token, provider, claims.email, userId)
      onReauthed()
    },
    [authManager, onReauthed, provider, session.identityEmail, tr]
  )

  const handleReauth = async () => {
    setError(null)
    setBusy(true)
    try {
      if (!authManager) throw new Error(tr('Still connecting — try again in a moment'))
      if (e2e) {
        const claims = await authManager.signInWithE2eEmail(session.identityEmail)
        const token = authManager.getIdToken()
        if (!token) throw new Error(tr('Sign-in failed'))
        saveIdCredentials(token, provider, claims.email, await deriveUserId(claims.iss, claims.sub))
        onReauthed()
      } else if (provider === 'google') {
        // The page leaves for Google and comes back to this workspace: it stays busy until it is gone.
        const deviceKeyId = await authManager.deviceKeyId()
        if (startGoogleRedirect({ deviceKeyId, purpose: 'renew', email: session.identityEmail, locale })) return
        throw new Error(tr('Signing in needs this site’s storage. Allow site data for Peerly in your browser and try again.'))
      } else {
        await completeWithToken(await signInWithProvider(provider, await authManager.deviceKeyId()))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  if (phase === 'ok') return null

  return (
    <div
      role="alert"
      className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 text-sm sm:px-5 ${
        phase === 'expired'
          ? 'border-error/25 bg-error/10 text-error'
          : 'border-warning/25 bg-warning/10 text-warning'
      }`}
      data-testid="reauth-banner"
    >
      <span className="min-w-0 flex-1">
        {phase === 'expired'
          ? tr('Your sign-in expired. Sign in again to reconnect securely.')
          : tr('Your sign-in ends within a day. Sign in again to keep accepting new connections.')}
      </span>
      <button
        type="button"
        className={`btn btn-sm shrink-0 ${phase === 'expired' ? 'btn-error' : 'btn-warning'}`}
        onClick={() => void handleReauth()}
        disabled={busy}
        data-testid="reauth-button"
      >
        {busy ? `${tr('Signing in')}…` : tr('Sign in again')}
      </button>
      {error && <span className="basis-full text-xs">{error}</span>}
    </div>
  )
}
