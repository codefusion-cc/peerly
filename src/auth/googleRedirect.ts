/**
 * Google sign-in by full-page redirect (@codefusion-cc/google-sign-in): no Google script, no FedCM, works wherever
 * the page can navigate (the Claude app's browser pane included).
 *
 * The browser leaves for Google and comes back to /login; where the person was (path, query and an invite link's
 * hash, which holds the workspace secret) waits in this tab's session storage and never goes to Google or the
 * Worker. `takeGoogleReturn` puts the address back before the app reads it, and `finishGoogleReturn` checks the
 * token and stores it before the first render.
 *
 * A redirect cannot renew a token without leaving the page, so a token lives 30 days (auth/deviceToken). Google
 * withdraws its signing keys after a week or two, though, and a token under a withdrawn key cannot be checked by
 * anyone. So a page load with a Google token over `REFRESH_AFTER_MS` old, or under a key Google no longer
 * publishes, asks Google again without a prompt (`prompt=none`), at most once a day per browser.
 */
import {
  readIdTokenClaims,
  startGoogleSignIn,
  takeGoogleSignInResult,
  type GoogleSignInResult,
} from '@codefusion-cc/google-sign-in/browser'
import { deviceSignInNonce } from './deviceToken'
import { getIdentityProvider, verifyProviderToken } from '../collab/identityProviders'

/** Why a sign-in leaves for Google: the login screen, the banner renewing it, or a quiet refresh at load. */
export type GooglePurpose = 'sign-in' | 'renew' | 'refresh'

/** A token older than this is refreshed quietly at the next page load (Google's keys outlive it comfortably). */
export const REFRESH_AFTER_MS = 3 * 24 * 60 * 60_000
/** A quiet refresh is tried at most this often per browser, whatever came of the last one. */
export const REFRESH_EVERY_MS = 24 * 60 * 60_000

const RETURN_KEY = 'peerly-google-return'
const REFRESH_AT_KEY = 'peerly-google-refresh-at'
/** The `iat` of a Google token `checkOwnGoogleToken` found nobody can verify any more. */
const UNUSABLE_KEY = 'peerly-google-unusable'

type ReturnRecord = { path: string; hash: string; purpose: GooglePurpose; email?: string }

/** What came back from Google, taken off the address before the app read it. */
let taken: { result: GoogleSignInResult; record: ReturnRecord | null } | null = null
/** Why a return from Google stored nothing, for the screen that started it to say. */
export type GoogleNotice =
  | { code: 'expired' | 'failed' | 'offline' | 'unconfigured' }
  | { code: 'other-account'; chosen: string; kept: string }

let notice: { purpose: GooglePurpose; notice: GoogleNotice } | null = null

const isPurpose = (value: unknown): value is GooglePurpose => value === 'sign-in' || value === 'renew' || value === 'refresh'
const isLocalPath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')

/**
 * Leaves for Google. False, and stays, when Google is not configured or this tab keeps no session storage (the
 * return could not be matched to this sign-in): the caller says sign-in needs storage.
 */
export function startGoogleRedirect(input: {
  deviceKeyId: string
  purpose: GooglePurpose
  /** The account to keep: Google preselects it, and a return with another is refused. */
  email?: string
  locale?: string
}): boolean {
  const provider = getIdentityProvider('google')
  if (!provider) return false
  const record: ReturnRecord = {
    path: `${location.pathname}${location.search}`,
    hash: location.hash,
    purpose: input.purpose,
    ...(input.email ? { email: input.email } : {}),
  }
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify(record))
  } catch {
    return false
  }
  const started = startGoogleSignIn({
    clientId: provider.clientId,
    nonce: deviceSignInNonce(input.deviceKeyId),
    returnPath: '/login',
    callbackOrigin: import.meta.env.VITE_GOOGLE_CALLBACK_ORIGIN?.trim() || undefined,
    locale: input.locale,
    loginHint: input.email,
    prompt: input.purpose === 'refresh' ? 'none' : 'select_account',
  })
  if (!started) forgetReturn()
  return started
}

function forgetReturn(): void {
  try {
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    // Nothing was kept, then.
  }
}

function readReturn(): ReturnRecord | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? 'null') as Partial<ReturnRecord> | null
    forgetReturn()
    if (!value || !isLocalPath(value.path) || typeof value.hash !== 'string' || !isPurpose(value.purpose)) return null
    if (value.hash && !value.hash.startsWith('#')) return null
    return { path: value.path, hash: value.hash, purpose: value.purpose, ...(typeof value.email === 'string' ? { email: value.email } : {}) }
  } catch {
    return null
  }
}

/**
 * Takes a return from Google off this load's address, once, and puts back where the sign-in started. Call it before
 * anything reads `location` (the router does at its first render).
 */
export function takeGoogleReturn(): void {
  const result = takeGoogleSignInResult()
  if (!result) return
  const record = readReturn()
  if (record) history.replaceState(history.state, '', `${record.path}${record.hash}`)
  taken = { result, record }
}

/** Whether this load came back from Google, with a result `finishGoogleReturn` has not taken yet. */
export function hasGoogleReturn(): boolean {
  return taken !== null
}

/** What the screen that started a sign-in should say about it, once; null when nothing. */
export function takeGoogleNotice(purpose: GooglePurpose): GoogleNotice | null {
  if (notice?.purpose !== purpose) return null
  const taken = notice.notice
  notice = null
  return taken
}

/** A notice as the person reads it. */
export function googleNoticeText(notice: GoogleNotice, tr: (english: string, values?: Record<string, string>) => string): string {
  switch (notice.code) {
    case 'expired': return tr('That sign-in took too long or started in another tab. Try again.')
    case 'offline': return tr('Couldn’t reach Google to check your sign-in. Check your connection and try again.')
    case 'unconfigured': return tr('Google sign-in isn’t set up here.')
    case 'other-account': return tr('You chose {chosen}, but Peerly is signed in as {kept}. Choose that account to stay signed in.', { chosen: notice.chosen, kept: notice.kept })
    default: return tr('Google sign-in didn’t finish. Try again.')
  }
}

/** A checked token from Google, for the session to store. */
export type GoogleCredential = { token: string; email: string; iss: string; sub: string; name?: string; picture?: string }

/**
 * Checks the token this load came back with: Google's, bound to this device by this sign-in's own nonce, for the
 * account the sign-in asked to keep. Null when there is nothing to store; why goes to `takeGoogleNotice`.
 * A cancelled or failed quiet refresh says nothing: the token the device has goes on working.
 */
export async function finishGoogleReturn(deviceKeyId: string): Promise<GoogleCredential | null> {
  if (!taken) return null
  const { result, record } = taken
  taken = null
  const purpose = record?.purpose ?? 'sign-in'
  const tell = (told: GoogleNotice) => {
    if (purpose !== 'refresh') notice = { purpose, notice: told }
    return null
  }
  if ('error' in result) {
    if (result.error === 'cancelled') return null
    return tell({ code: result.error === 'expired' ? 'expired' : 'failed' })
  }
  const provider = getIdentityProvider('google')
  if (!provider) return tell({ code: 'unconfigured' })
  const check = await verifyProviderToken(result.credential, provider, deviceKeyId)
  if (!check.ok) return tell({ code: check.problem === 'keys-unavailable' ? 'offline' : 'failed' })
  // Only this sign-in's nonce: a token from an earlier sign-in of this device is not this sign-in's answer.
  if (check.claims.nonce !== result.nonce) return tell({ code: 'failed' })
  if (record?.email && record.email.toLowerCase() !== check.claims.email.toLowerCase()) {
    return tell({ code: 'other-account', chosen: check.claims.email, kept: record.email })
  }
  return {
    token: result.credential,
    email: check.claims.email,
    iss: check.claims.iss,
    sub: check.claims.sub,
    ...(check.claims.name ? { name: check.claims.name } : {}),
    ...(check.claims.picture ? { picture: check.claims.picture } : {}),
  }
}

/**
 * Whether this page load should refresh a Google token quietly: one over `REFRESH_AFTER_MS` old, gone (past its 30
 * days), or found unusable since (`checkOwnGoogleToken`), for an account the device remembers; never offline or within
 * `REFRESH_EVERY_MS` of the last try. Decided from what the device holds, without the network, so the first render
 * never waits on Google.
 */
export function shouldRefreshGoogle(input: {
  token: string | null
  providerId: string | null
  email: string | null
  now?: number
}): boolean {
  const now = input.now ?? Date.now()
  if (!getIdentityProvider('google') || input.providerId !== 'google' || !input.email) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  if (now - lastRefreshAt() < REFRESH_EVERY_MS) return false
  if (!input.token) return true
  const iat = readIdTokenClaims(input.token)?.iat
  if (typeof iat !== 'number' || now - iat * 1000 >= REFRESH_AFTER_MS) return true
  return readStored(UNUSABLE_KEY) === String(iat)
}

/**
 * Checks this device's own Google token as its peers do, once the page is up. One nobody can verify any more (Google
 * withdrew its key) or that names another device key (the device's keys were cleared) is `unusable`: the person is
 * told, and the next page load refreshes it quietly. `unknown` when Google's keys could not be read.
 */
export async function checkOwnGoogleToken(input: { token: string; deviceKeyId: string; now?: number }): Promise<'ok' | 'unusable' | 'unknown'> {
  const provider = getIdentityProvider('google')
  if (!provider) return 'unknown'
  const check = await verifyProviderToken(input.token, provider, input.deviceKeyId, input.now)
  if (check.ok) return 'ok'
  if (check.problem === 'keys-unavailable') return 'unknown'
  const iat = readIdTokenClaims(input.token)?.iat
  if (typeof iat === 'number') writeStored(UNUSABLE_KEY, String(iat))
  return 'unusable'
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function lastRefreshAt(): number {
  try {
    const value = Number(localStorage.getItem(REFRESH_AT_KEY))
    return Number.isFinite(value) ? value : 0
  } catch {
    // Without storage a try could not be remembered, so none is made.
    return Number.POSITIVE_INFINITY
  }
}

/** Leaves for Google without a prompt, recording the try first so a return that never comes cannot loop. */
export function refreshGoogleQuietly(input: { deviceKeyId: string; email: string; now?: number }): boolean {
  if (!writeStored(REFRESH_AT_KEY, String(input.now ?? Date.now()))) return false
  return startGoogleRedirect({ deviceKeyId: input.deviceKeyId, purpose: 'refresh', email: input.email })
}

/**
 * What a page load does about Google, before the first render: store the token it came back with, or leave to
 * refresh an aging one quietly (`shouldRefreshGoogle`), or nothing. Never both, so a return that stored nothing
 * cannot send the page straight back to Google. At load nothing is under way yet (no call, no upload).
 */
export function settleGoogleAtLoad(input: {
  deviceKeyId: string
  token: string | null
  providerId: string | null
  email: string | null
}): Promise<LoadSettled> {
  // Once per page load: React's StrictMode runs the bootstrap twice, and the second run must not see "no return"
  // and leave for Google again.
  return settling ??= settle(input)
}

type LoadSettled = { kind: 'stored'; credential: GoogleCredential } | { kind: 'leaving' } | { kind: 'stay' }
let settling: Promise<LoadSettled> | null = null

async function settle(input: Parameters<typeof settleGoogleAtLoad>[0]): Promise<LoadSettled> {
  if (hasGoogleReturn()) {
    const credential = await finishGoogleReturn(input.deviceKeyId)
    return credential ? { kind: 'stored', credential } : { kind: 'stay' }
  }
  const { email } = input
  if (email && shouldRefreshGoogle(input) && refreshGoogleQuietly({ deviceKeyId: input.deviceKeyId, email })) {
    return { kind: 'leaving' }
  }
  return { kind: 'stay' }
}
