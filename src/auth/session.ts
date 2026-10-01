/**
 * Who is signed in on this device, and the device key that signs for them.
 *
 * Signing in hands the provider's ID token (bound to this device's key by its
 * nonce) to the realtime control client, which enrolls the device and opens a
 * session; from then on the device's key and its session cookie are enough,
 * and the token is forgotten. The account shown here is read from the token
 * for display only: the Worker verifies it, and every server decision uses
 * what the Worker derived.
 */
import { readIdTokenClaims } from '@codefusion-cc/google-sign-in/browser'
import {
  clearRealtimeAccountState, closeDurableObjectsTransport, configureRuntimeAuthCredentialProvider, deriveUserId, DeviceIdentity,
  deviceKeyStore, ensureDurableObjectsSession, getDurableObjectsTransport,
} from '@codefusion-cc/realtime/browser'
import { APP_ID } from '../config.ts'

export type ProviderId = 'google' | 'microsoft' | 'apple' | 'oidc'

/** The signed-in account, as this device shows it. */
export type Account = {
  /** The public user id the Worker derives from the provider's issuer and subject. */
  userId: string
  email: string
  name: string
  picture?: string
  provider: ProviderId
}

const ACCOUNT_KEY = 'peerly-account'
const ENROLLMENT_KEY = 'peerly-enrollment'

/** This browser's device key: made once, non-extractable, kept in IndexedDB. */
export const device = new DeviceIdentity(deviceKeyStore(APP_ID))

const listeners = new Set<() => void>()
let account: Account | null = readAccount()
/** The provider token, held only until the device is enrolled (and across a reload in this tab). */
let enrollment: { token: string; providerId: ProviderId } | null = readEnrollment()

function readAccount(): Account | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null') as Partial<Account> | null
    return value && typeof value.userId === 'string' && typeof value.email === 'string' && typeof value.name === 'string' &&
      typeof value.provider === 'string' ? value as Account : null
  } catch {
    return null
  }
}

function readEnrollment(): typeof enrollment {
  try {
    const value = JSON.parse(sessionStorage.getItem(ENROLLMENT_KEY) ?? 'null') as typeof enrollment
    return value && typeof value.token === 'string' && typeof value.providerId === 'string' ? value : null
  } catch {
    return null
  }
}

function writeEnrollment(value: typeof enrollment) {
  enrollment = value
  try {
    if (value) sessionStorage.setItem(ENROLLMENT_KEY, JSON.stringify(value))
    else sessionStorage.removeItem(ENROLLMENT_KEY)
  } catch {
    // Held in memory for this page.
  }
}

function setAccount(next: Account | null) {
  account = next
  try {
    if (next) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next))
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch {
    // Signed in for this page only.
  }
  for (const listener of listeners) listener()
}

configureRuntimeAuthCredentialProvider(() => account
  ? { accountId: account.userId, signer: device, ...(enrollment ? { enrollment: { token: enrollment.token, providerId: enrollment.providerId } } : {}) }
  : null)

/** The account signed in on this device, or null. */
export const currentAccount = () => account

/** Calls `listener` whenever the signed-in account changes (here or by signing out). */
export function subscribeAccount(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The account a provider's token names, for display: null for a token that names no verified address. */
export async function accountFromToken(credential: string, provider: ProviderId): Promise<Account | null> {
  const claims = readIdTokenClaims(credential)
  const email = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : ''
  if (!claims || typeof claims.iss !== 'string' || typeof claims.sub !== 'string' || !email.includes('@')) return null
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 80) : email.split('@')[0]
  const picture = typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture : undefined
  return { userId: await deriveUserId(claims.iss, claims.sub), email, name, provider, ...(picture ? { picture } : {}) }
}

/** Why signing in stopped: the token was refused, the account is suspended, or the server could not be reached. */
export class SignInError extends Error {
  readonly reason: 'rejected' | 'suspended' | 'unavailable' | 'invalid'
  constructor(reason: SignInError['reason']) {
    super(`sign-in ${reason}`)
    this.reason = reason
  }
}

/** How long a sign-in waits for the server before saying it is unavailable (the client keeps retrying). */
const SIGN_IN_WAIT_MS = 20_000

/** The control client's first settled outcome: ready, signed out, suspended, or still not through after a while. */
async function sessionOutcome(): Promise<'ready' | 'signed-out' | 'suspended' | 'unavailable'> {
  const transport = getDurableObjectsTransport(APP_ID)
  const settled = () => ['ready', 'signed-out', 'suspended'].includes(transport.state) ? transport.state as 'ready' | 'signed-out' | 'suspended' : null
  await ensureDurableObjectsSession(APP_ID)
  if (settled()) return settled()!
  return new Promise(resolve => {
    const timer = setTimeout(() => { transport.events.removeEventListener('state', onState); resolve('unavailable') }, SIGN_IN_WAIT_MS)
    const onState = () => {
      const outcome = settled()
      if (!outcome) return
      clearTimeout(timer)
      transport.events.removeEventListener('state', onState)
      resolve(outcome)
    }
    transport.events.addEventListener('state', onState)
  })
}

/**
 * Finishes a sign-in with the provider's token: enrolls this device and opens
 * its session. Rejects with a `SignInError` and leaves nobody signed in when
 * the Worker refuses the token or cannot be reached.
 */
export async function completeSignIn(credential: string, provider: ProviderId): Promise<Account> {
  const next = await accountFromToken(credential, provider)
  if (!next) throw new SignInError('invalid')
  // Another account's session on this device ends first: its stored capability is not this one's.
  if (account && account.userId !== next.userId) await signOut({ keepPendingSignIn: true })
  writeEnrollment({ token: credential, providerId: provider })
  account = next
  const outcome = await sessionOutcome().catch(() => 'unavailable' as const)
  writeEnrollment(null)
  if (outcome !== 'ready') {
    account = null
    closeDurableObjectsTransport(APP_ID)
    await clearRealtimeAccountState(APP_ID, next.userId).catch(() => {})
    throw new SignInError(outcome === 'signed-out' ? 'rejected' : outcome)
  }
  setAccount(next)
  return next
}

/** Signs this device out: the server ends its session, and the control client forgets it. Local workspaces stay. */
export async function signOut({ keepPendingSignIn = false } = {}): Promise<void> {
  const leaving = account
  writeEnrollment(null)
  try {
    await fetch('/api/realtime/logout', { method: 'POST', credentials: 'same-origin' })
  } catch {
    // Offline: the session expires on its own, and this device no longer holds its cookie's use.
  }
  closeDurableObjectsTransport(APP_ID)
  await clearRealtimeAccountState(APP_ID, leaving?.userId).catch(() => {})
  if (!keepPendingSignIn) {
    const { cancelGoogleSignIn } = await import('@codefusion-cc/google-sign-in/browser')
    const { cancelRedirectSignIn } = await import('./redirectSignIn.ts')
    cancelGoogleSignIn()
    cancelRedirectSignIn()
  }
  setAccount(null)
}
