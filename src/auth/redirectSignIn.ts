/**
 * Signing in with Microsoft, Apple or an OpenID Connect provider, by full-page
 * redirect: the page leaves for the provider, which posts the ID token to the
 * Worker (`/api/auth/<provider>/callback`, `response_mode=form_post`), which
 * sends the browser back here with it in the URL fragment. The same shape as
 * `@codefusion-cc/google-sign-in/browser`, and self-contained so it can move
 * next to it.
 *
 * The sign-in is matched to this tab: its state and nonce wait in session
 * storage, the return must carry exactly that state, and only within ten
 * minutes. The nonce is the device key, so the token is bound to this device.
 */
export type RedirectProvider = 'microsoft' | 'apple' | 'oidc'

/** What a provider's button needs to start (the Worker's `/api/auth/providers`). */
export type RedirectSignInOption = { id: RedirectProvider; clientId: string; authorizationUrl: string }

/** How a return ended: a token with the nonce the sign-in sent, or why not. */
export type RedirectSignInResult =
  | { provider: RedirectProvider; credential: string; nonce: string }
  | { provider: RedirectProvider | null; error: 'cancelled' | 'expired' | 'failed'; code?: string }

const PENDING_KEY = 'peerly-redirect-sign-in'
const MAX_AGE_MS = 10 * 60_000
/** Each provider's word for "the person closed the chooser". */
const CANCELLED = new Set(['access_denied', 'user_cancelled_authorize', 'user_cancelled_login'])
const PROVIDERS = new Set<RedirectProvider>(['microsoft', 'apple', 'oidc'])

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const utf8Base64Url = (text: string) => base64Url(new TextEncoder().encode(text))

/** A new state naming where to come back: `<random>.<base64url JSON [origin, path]>`, as the Worker reads it. */
export function signInState(origin: string, path: string): string {
  return `${base64Url(crypto.getRandomValues(new Uint8Array(24)))}.${utf8Base64Url(JSON.stringify([origin, path]))}`
}

/** The provider's authorization address for this sign-in. */
export function redirectAuthorizationUrl(option: RedirectSignInOption, input: { nonce: string; state: string; callbackOrigin: string; locale?: string; loginHint?: string }): URL {
  const url = new URL(option.authorizationUrl)
  url.searchParams.set('client_id', option.clientId)
  url.searchParams.set('response_type', 'id_token')
  url.searchParams.set('response_mode', 'form_post')
  url.searchParams.set('scope', option.id === 'apple' ? 'openid email name' : 'openid email profile')
  url.searchParams.set('redirect_uri', `${input.callbackOrigin}/api/auth/${option.id}/callback`)
  url.searchParams.set('nonce', input.nonce)
  url.searchParams.set('state', input.state)
  if (option.id !== 'apple') url.searchParams.set('prompt', 'select_account')
  if (input.locale && option.id === 'microsoft') url.searchParams.set('ui_locales', input.locale)
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint)
  return url
}

/**
 * Leaves for the provider; the browser comes back to `returnPath`, where
 * `takeRedirectSignInResult` finishes. False, and stays, when this tab keeps
 * no session storage (the return could not be matched to this sign-in).
 */
export function startRedirectSignIn(option: RedirectSignInOption, request: {
  nonce: string
  returnPath?: string
  /** The origin whose Worker takes the provider's post (a stable one for branch previews). */
  callbackOrigin?: string
  locale?: string
  loginHint?: string
}): boolean {
  if (!PROVIDERS.has(option.id) || !option.clientId || !request.nonce) throw new TypeError('A sign-in needs a provider, client id and nonce')
  const returnPath = request.returnPath ?? `${location.pathname}${location.search}`
  if (!returnPath.startsWith('/') || returnPath.startsWith('//')) throw new TypeError('The return path must be on this origin')
  const state = signInState(location.origin, returnPath)
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ state, nonce: request.nonce, provider: option.id, createdAt: Date.now() }))
  } catch {
    return false
  }
  location.assign(redirectAuthorizationUrl(option, { nonce: request.nonce, state, callbackOrigin: request.callbackOrigin ?? location.origin, locale: request.locale, loginHint: request.loginHint }).href)
  return true
}

/** The sign-in this tab started, if `state` is its return and it is recent; forgotten then, and when stale or unreadable. */
function takePending(state: string, now: number): { nonce: string; provider: RedirectProvider } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as Record<string, unknown> | null
    const valid = value && typeof value.state === 'string' && typeof value.nonce === 'string' &&
      typeof value.createdAt === 'number' && PROVIDERS.has(value.provider as RedirectProvider)
    const current = valid && now - (value.createdAt as number) < MAX_AGE_MS && (value.createdAt as number) <= now + 60_000
    if (!valid || !current || value.state === state) sessionStorage.removeItem(PENDING_KEY)
    return valid && current && value.state === state ? { nonce: value.nonce as string, provider: value.provider as RedirectProvider } : null
  } catch {
    return null
  }
}

/**
 * Takes the result the Worker left in this page's URL fragment, removing it
 * from the address bar and history, once: null when this load is not a return
 * from a redirect sign-in.
 */
export function takeRedirectSignInResult(now = Date.now()): RedirectSignInResult | null {
  const params = new URLSearchParams(location.hash.slice(1))
  const provider = params.get('provider') as RedirectProvider | null
  const state = params.get('state')
  if (!provider || !PROVIDERS.has(provider) || state === null) return null
  history.replaceState(history.state, '', location.pathname + location.search)
  const pending = takePending(state, now)
  if (!pending || pending.provider !== provider) return { provider, error: 'expired' }
  const credential = params.get('id_token')
  if (credential) return { provider, credential, nonce: pending.nonce }
  const code = params.get('error') ?? undefined
  return { provider, error: code && CANCELLED.has(code) ? 'cancelled' : 'failed', ...(code ? { code } : {}) }
}

/** Forgets a sign-in that left for its provider, so its return cannot complete (on signing out, say). */
export function cancelRedirectSignIn(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // No storage, so nothing was pending either.
  }
}
