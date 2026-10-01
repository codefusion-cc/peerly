import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { startGoogleSignIn, takeGoogleSignInResult } from '@codefusion-cc/google-sign-in/browser'
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { ROUTES } from '../../shared/app.ts'
import { authOrigin, E2E_AUTH } from '../config.ts'
import { useI18n } from '../i18nContext.tsx'
import { navigate } from '../router.ts'
import { ProviderIcon } from './ProviderIcon.tsx'
import { startRedirectSignIn, takeRedirectSignInResult, type RedirectSignInOption } from './redirectSignIn.ts'
import { completeSignIn, device, SignInError, type ProviderId } from './session.ts'

type ProviderOption = { id: 'google'; clientId: string } | (RedirectSignInOption & { label?: string })

const PROVIDER_NAMES: Record<Exclude<ProviderId, 'oidc'>, string> = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple' }

/** Where to go once signed in: the `next` the sign-in started with, if it is a path on this origin. */
export function nextPath(search: string): string {
  const next = new URLSearchParams(search).get('next') ?? '/'
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/signin') ? next : '/'
}

/** A return from a provider, taken once per page load (React may mount this page twice). */
let taken: ReturnType<typeof takeReturn> | undefined
function takeReturn() {
  const google = takeGoogleSignInResult()
  if (google) return { ...google, provider: 'google' as const }
  return takeRedirectSignInResult()
}

export function SignInPage() {
  const { t, locale } = useI18n()
  const [options, setOptions] = useState<ProviderOption[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<ProviderId | 'return' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadFailed(false)
    try {
      const response = await fetch(ROUTES.signInOptions, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(String(response.status))
      setOptions(((await response.json()) as { providers: ProviderOption[] }).providers)
    } catch {
      setLoadFailed(true)
    }
  }, [])

  const finish = useCallback(async (credential: string, provider: ProviderId) => {
    setBusy('return')
    setError(null)
    try {
      await completeSignIn(credential, provider)
      navigate(nextPath(location.search), { replace: true })
    } catch (failure) {
      const reason = failure instanceof SignInError ? failure.reason : 'unavailable'
      setError(reason === 'unavailable' ? t.signInUnavailable : reason === 'suspended' ? t.signInSuspended : t.signInRejected)
      setBusy(null)
    }
  }, [t])

  useEffect(() => {
    void load()
    taken ??= takeReturn()
    const result = taken
    if (!result) return
    taken = null
    if ('credential' in result) void finish(result.credential, result.provider as ProviderId)
    else if (result.error === 'expired') setError(t.signInExpired)
    else if (result.error !== 'cancelled') setError(t.signInFailed)
  }, [load, finish, t])

  const start = async (option: ProviderOption) => {
    setError(null)
    setBusy(option.id)
    const nonce = await device.publicKeyId()
    const returnPath = `/signin${location.search}`
    const started = option.id === 'google'
      ? startGoogleSignIn({ clientId: option.clientId, nonce, returnPath, callbackOrigin: authOrigin(), locale })
      : startRedirectSignIn(option, { nonce, returnPath, callbackOrigin: authOrigin(), locale })
    if (!started) {
      setBusy(null)
      setError(t.signInNeedsStorage)
    }
  }

  return (
    <main id="content" className="grid min-h-full lg:grid-cols-[minmax(0,1.1fr)_minmax(26rem,0.9fr)]">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-primary via-secondary to-accent p-10 text-primary-content lg:flex lg:flex-col lg:justify-end" aria-hidden="true">
        <img src="/app-icon.png" alt="" className="absolute right-10 top-10 size-24 rounded-3xl shadow-2xl" />
        <div className="relative max-w-lg space-y-6">
          <p className="text-4xl font-bold leading-tight">{t.tagline}</p>
          <ul className="space-y-3 text-lg">
            {t.heroPoints.map(point => (
              <li key={point} className="flex gap-3"><CheckCircle2 className="mt-1 size-5 shrink-0" />{point}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex items-center justify-center p-4 sm:p-10">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <img src="/app-icon.png" alt="" className="size-10 rounded-xl lg:hidden" />
              <span className="brand-wordmark text-3xl font-bold">{t.appName}</span>
            </div>
            <h1 className="text-2xl font-semibold">{t.signInTitle}</h1>
            <p className="text-base-content/70">{t.signInBody}</p>
          </div>

          {error && <div role="alert" className="alert alert-error alert-soft">{error}</div>}

          {busy === 'return' ? (
            <p className="flex items-center gap-3 text-base-content/80" role="status">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />{t.signingIn}
            </p>
          ) : E2E_AUTH ? (
            <E2eSignIn onToken={finish} />
          ) : loadFailed ? (
            <div className="space-y-3">
              <p role="alert" className="text-error">{t.signInProvidersFailed}</p>
              <button type="button" className="btn btn-outline" onClick={() => void load()}>
                <RefreshCw className="size-4" aria-hidden="true" />{t.retry}
              </button>
            </div>
          ) : !options ? (
            <div className="space-y-3" aria-busy="true" aria-label={t.loading}>
              <div className="skeleton h-12 w-full" />
              <div className="skeleton h-12 w-full" />
            </div>
          ) : options.length === 0 ? (
            <p className="text-base-content/70">{t.signInNoProviders}</p>
          ) : (
            <nav className="space-y-3" aria-label={t.signInProviders}>
              {options.map(option => {
                const name = option.id === 'oidc' ? (option as { label?: string }).label ?? 'SSO' : PROVIDER_NAMES[option.id]
                return (
                  <button key={option.id} type="button" className="btn btn-outline btn-block h-12 justify-start gap-3 text-base font-medium"
                    disabled={busy !== null} onClick={() => void start(option)}>
                    {busy === option.id ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <ProviderIcon provider={option.id} />}
                    {t.signInWith(name)}
                  </button>
                )
              })}
            </nav>
          )}

          <p className="text-sm text-base-content/60">
            {t.signInLegal(<a key="terms" className="link" href="/terms">{t.terms}</a>, <a key="privacy" className="link" href="/privacy">{t.privacy}</a>)}
          </p>
        </div>
      </section>
    </main>
  )
}

/** The end-to-end tests' sign-in: any address, with the test issuer. Never in a deployable build. */
function E2eSignIn({ onToken }: { onToken(credential: string, provider: ProviderId): void }) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const { e2eToken } = await import('./e2eSignIn.ts')
    const { credential, provider } = await e2eToken(email, await device.publicKeyId())
    onToken(credential, provider)
  }
  return (
    <form className="space-y-3" onSubmit={event => void submit(event)}>
      <label className="input w-full">
        <span className="label">{t.email}</span>
        <input type="email" required value={email} onChange={event => setEmail(event.target.value)} data-testid="e2e-email" />
      </label>
      <button type="submit" className="btn btn-primary btn-block" data-testid="e2e-sign-in">{t.signInWith('E2E')}</button>
    </form>
  )
}
