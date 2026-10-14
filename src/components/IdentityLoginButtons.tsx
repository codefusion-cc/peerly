import { useCallback, useEffect, useState } from 'react'
import { ensureOidcAvatar, resolveAvatarPreview } from '../collab/avatarService'
import { loadStoredProfile } from '../collab/profileStore'
import { isE2eAuthBypass } from '../collab/e2eAuth'
import { googleNoticeText, startGoogleRedirect, takeGoogleNotice } from '../auth/googleRedirect'
import {
  getConfiguredIdentityProviders,
  getIdentityProvider,
  identityConfigurationError,
  type IdentityProviderId,
} from '../collab/identityProviders'
import { signInWithProvider } from '../collab/providerSignIn'
import { deriveUserId } from '../collab/userId'
import { saveIdCredentials } from '../session'
import { WorkspaceAuthManager } from '../collab/workspaceAuth'
import { Avatar } from './Avatar'
import { useI18n } from '../i18n'

export type SignedInIdentity = {
  email: string
  name?: string
  token: string
  providerId: IdentityProviderId
  /** Durable user id (hash of the token's iss+sub) — see collab/userId. */
  userId?: string
}

type Props = {
  authManager: WorkspaceAuthManager
  signedIn: SignedInIdentity | null
  onSignedIn: (identity: SignedInIdentity) => void
  onSignOut: () => void
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onError: (message: string | null) => void
}

/** Google's "G", as its sign-in branding asks a button to show it. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5 shrink-0" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/** Compact identity chip, shown at the top once signed in. */
function SignedInChip({
  signedIn,
  busy,
  onSignOut,
}: {
  signedIn: SignedInIdentity
  busy: boolean
  onSignOut: () => void
}) {
  const { tr } = useI18n()
  const label = getIdentityProvider(signedIn.providerId)?.label
  const [avatar, setAvatar] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    void resolveAvatarPreview(loadStoredProfile().avatarId).then(url => {
      if (!cancelled) setAvatar(url)
    })
    return () => {
      cancelled = true
    }
  }, [signedIn.email])

  return (
    <div
      className="signed-in-banner flex items-center gap-3 rounded-box border border-base-300 bg-base-200 px-3 py-2"
      data-testid="signed-in-user"
    >
      <Avatar name={signedIn.name ?? signedIn.email} color="#2eb67d" avatar={avatar} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-base-content">
          {signedIn.name ?? signedIn.email}
        </p>
        <p className="truncate text-xs text-base-content/60">
          {signedIn.email}
          {label ? ` · ${label}` : ''}
        </p>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        data-testid="sign-out"
        onClick={onSignOut}
        disabled={busy}
      >
        {tr('Sign out')}
      </button>
    </div>
  )
}

export function IdentityLoginButtons({
  authManager,
  signedIn,
  onSignedIn,
  onSignOut,
  busy,
  onBusyChange,
  onError,
}: Props) {
  const { tr, locale } = useI18n()
  const providers = getConfiguredIdentityProviders()
  const [e2eEmail, setE2eEmail] = useState('alice@e2e.test')
  const [leavingForGoogle, setLeavingForGoogle] = useState(false)

  // What came of a return from Google that stored nothing (a cancel says nothing).
  useEffect(() => {
    const notice = takeGoogleNotice('sign-in')
    if (notice) onError(googleNoticeText(notice, tr))
  }, [onError, tr])

  // Back from Google's page by the Back button: this page comes out of the back-forward cache as it was left.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setLeavingForGoogle(false)
    }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [])

  const continueWithGoogle = async () => {
    onError(null)
    setLeavingForGoogle(true)
    try {
      const deviceKeyId = await authManager.deviceKeyId()
      if (startGoogleRedirect({ deviceKeyId, purpose: 'sign-in', locale })) return
      onError(tr('Signing in needs this site’s storage. Allow site data for Peerly in your browser and try again.'))
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
    setLeavingForGoogle(false)
  }

  const completeSignIn = useCallback(
    async (providerId: IdentityProviderId, token: string) => {
      const claims = await authManager.verifyAndStoreIdToken(token, providerId)
      const userId = await deriveUserId(claims.iss, claims.sub)
      await ensureOidcAvatar(claims.picture)
      // Identity is app-wide, not workspace-scoped. Persist it immediately so
      // App can render Home and the global rail before a workspace is opened.
      saveIdCredentials(token, providerId, claims.email, userId)
      onSignedIn({ email: claims.email, name: claims.name, token, providerId, userId })
    },
    [authManager, onSignedIn]
  )

  const handleProviderSignIn = async (providerId: IdentityProviderId) => {
    onError(null)
    onBusyChange(true)
    try {
      const provider = getIdentityProvider(providerId)
      if (!provider) throw new Error(tr('Identity provider “{provider}” is not configured', { provider: providerId }))

      const keyId = await authManager.deviceKeyId()
      const token = await signInWithProvider(providerId, keyId)
      await completeSignIn(providerId, token)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      onBusyChange(false)
    }
  }

  const handleE2eSignIn = async () => {
    onError(null)
    onBusyChange(true)
    try {
      const email = e2eEmail.trim()
      if (!email) throw new Error(tr('Enter your email to continue'))
      const claims = await authManager.signInWithE2eEmail(email)
      const token = authManager.getIdToken()
      if (!token) throw new Error(tr('Sign-in failed'))
      // Whichever provider actually minted it. Hardcoding 'google' here meant
      // the Durable Objects harness — which signs in through the generic
      // `oidc` provider so the worker can verify the token too — stored a
      // provider the worker would then reject.
      const providerId = authManager.getIdentityProvider() ?? 'google'
      const userId = await deriveUserId(claims.iss, claims.sub)
      saveIdCredentials(token, providerId, claims.email, userId)
      onSignedIn({ email: claims.email, name: claims.name, token, providerId, userId })
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      onBusyChange(false)
    }
  }

  if (signedIn) {
    return (
      <SignedInChip
        signedIn={signedIn}
        busy={busy}
        onSignOut={onSignOut}
      />
    )
  }

  // Test mode owns its email field rather than reaching into the DOM for one the
  // join screen happened to render. That coupling is also why the field used to
  // sit inside the create-workspace form: it is a sign-in input, and it has to
  // exist *before* sign-in — which is exactly what gating that form would break.
  if (isE2eAuthBypass()) {
    return (
      <div className="flex flex-col gap-3" data-testid="identity-login">
        <label className="w-full">
          <span className="mb-1 block text-xs font-medium text-base-content/70">
            {tr('Your email (test mode)')}
          </span>
          <input
            id="e2e-sign-in-email"
            name="email"
            type="email"
            className="input input-bordered w-full"
            placeholder="alice@e2e.test"
            data-testid="e2e-email"
            value={e2eEmail}
            onChange={e => setE2eEmail(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary w-full"
          data-testid="signin-e2e"
          onClick={() => void handleE2eSignIn()}
          disabled={busy}
        >
          {busy ? `${tr('Signing in')}…` : tr('Sign in (test mode)')}
        </button>
      </div>
    )
  }

  if (providers.length === 0) {
    return (
      <div role="alert" className="alert alert-error" data-testid="no-identity-provider">
        <span className="text-sm">{identityConfigurationError()}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-testid="identity-login">
      <div className="flex flex-col items-center gap-2" data-testid="identity-providers">
        {providers.map(provider =>
          provider.id === 'google' ? (
            <button
              key="google"
              type="button"
              className="btn btn-outline w-full gap-3"
              data-testid="signin-google"
              onClick={() => void continueWithGoogle()}
              disabled={busy || leavingForGoogle}
              aria-busy={leavingForGoogle}
            >
              {leavingForGoogle ? (
                <span className="loading loading-spinner loading-sm" aria-hidden="true" />
              ) : (
                <GoogleMark />
              )}
              {leavingForGoogle ? `${tr('Opening Google')}…` : `${tr('Continue with')} Google`}
            </button>
          ) : (
            <button
              key={provider.id}
              type="button"
              className="btn btn-outline w-full"
              data-testid={`signin-${provider.id}`}
              onClick={() => void handleProviderSignIn(provider.id)}
              disabled={busy}
            >
              {tr('Continue with')} {provider.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}
