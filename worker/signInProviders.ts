/**
 * The identity providers a sign-in can use, as the Worker checks their ID
 * tokens: Google, Microsoft (one tenant), Apple and any OpenID Connect issuer.
 *
 * Self-contained on purpose (no app imports, configuration as parameters): it
 * is meant to move into a shared sign-in package next to Google's.
 *
 * Every provider must vouch for the email it asserts, because access to a
 * workspace is decided by that address:
 * - Microsoft only for one tenant. Azure lets a tenant's admin give an account
 *   any address unverified, so with several tenants anyone could make a free
 *   one, assert a member's address and walk in ("nOAuth"); `common`,
 *   `organizations` and `consumers` are refused, in any case. Its verified
 *   address is `xms_edov`, an optional claim the app registration must add.
 * - Apple sends `email_verified` as the string "true"; it counts.
 */
import { GOOGLE_ISSUERS, googleKeys, remoteKeys, verifyIdToken, type IdTokenCheck } from '@codefusion-cc/google-sign-in'

/** Where each provider's settings come from: the Worker's vars. */
export type SignInEnv = {
  GOOGLE_CLIENT_ID?: string
  MICROSOFT_CLIENT_ID?: string
  MICROSOFT_TENANT_ID?: string
  APPLE_CLIENT_ID?: string
  OIDC_ISSUER?: string
  OIDC_CLIENT_ID?: string
  /** The issuer's key set; read from its discovery document when not set. */
  OIDC_JWKS_URL?: string
  /** What the page calls the OpenID Connect provider ("Company SSO"). */
  OIDC_LABEL?: string
}

/** A provider the page can offer, with what its button needs. */
export type SignInOption =
  | { id: 'google'; clientId: string }
  | { id: 'microsoft'; clientId: string; tenantId: string; authorizationUrl: string }
  | { id: 'apple'; clientId: string; authorizationUrl: string }
  | { id: 'oidc'; clientId: string; issuer: string; label: string; authorizationUrl: string }

/** A provider's token check, as the realtime routes take it. */
export type SignInVerifier = { verify(token: string, nonce: string, now: number): Promise<IdTokenCheck> }

const APPLE_ISSUER = 'https://appleid.apple.com'
const APPLE_KEYS = 'https://appleid.apple.com/auth/keys'
const APPLE_AUTHORIZE = 'https://appleid.apple.com/auth/authorize'
const MULTI_TENANT = new Set(['common', 'organizations', 'consumers'])
const TENANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DISCOVERY_FRESH_MS = 60 * 60_000

const value = (text: string | undefined) => text?.trim() || ''

/**
 * Microsoft's issuer for one tenant (a directory id), or null for a value that
 * would let other tenants in, or is not a directory id at all.
 */
export function microsoftIssuer(tenantId: string | undefined): string | null {
  const tenant = value(tenantId).toLowerCase()
  if (!tenant || MULTI_TENANT.has(tenant) || !TENANT.test(tenant)) return null
  return `https://login.microsoftonline.com/${tenant}/v2.0`
}

/** An https issuer without a trailing slash, or null. */
function oidcIssuer(issuer: string | undefined): string | null {
  try {
    const url = new URL(value(issuer))
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.search || url.hash) return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

/** Each issuer's discovery document, read at most once an hour per isolate. */
const discovered = new Map<string, { at: number; read: Promise<{ jwks_uri: string; authorization_endpoint: string } | null> }>()
function discover(issuer: string, now = Date.now()) {
  const cached = discovered.get(issuer)
  if (cached && now - cached.at < DISCOVERY_FRESH_MS) return cached.read
  const read = fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5_000) })
    .then(response => response.ok ? response.json() as Promise<Record<string, unknown>> : null)
    .then(document => document && document.issuer === issuer && typeof document.jwks_uri === 'string' &&
      typeof document.authorization_endpoint === 'string'
      ? { jwks_uri: document.jwks_uri, authorization_endpoint: document.authorization_endpoint } : null)
    .catch(() => null)
  discovered.set(issuer, { at: now, read })
  // A failed read is asked again next time, not kept for an hour.
  void read.then(document => { if (!document && discovered.get(issuer)?.read === read) discovered.delete(issuer) })
  return read
}

/** The providers this deployment offers, as the page shows them. Misconfigured ones are left out. */
export async function signInOptions(env: SignInEnv): Promise<SignInOption[]> {
  const options: SignInOption[] = []
  if (value(env.GOOGLE_CLIENT_ID)) options.push({ id: 'google', clientId: value(env.GOOGLE_CLIENT_ID) })
  const microsoft = microsoftIssuer(env.MICROSOFT_TENANT_ID)
  if (microsoft && value(env.MICROSOFT_CLIENT_ID)) {
    const tenantId = value(env.MICROSOFT_TENANT_ID).toLowerCase()
    options.push({
      id: 'microsoft', clientId: value(env.MICROSOFT_CLIENT_ID), tenantId,
      authorizationUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    })
  }
  if (value(env.APPLE_CLIENT_ID)) options.push({ id: 'apple', clientId: value(env.APPLE_CLIENT_ID), authorizationUrl: APPLE_AUTHORIZE })
  const issuer = oidcIssuer(env.OIDC_ISSUER)
  if (issuer && value(env.OIDC_CLIENT_ID)) {
    const document = await discover(issuer)
    if (document) {
      options.push({
        id: 'oidc', clientId: value(env.OIDC_CLIENT_ID), issuer, label: value(env.OIDC_LABEL).slice(0, 40) || 'SSO',
        authorizationUrl: document.authorization_endpoint,
      })
    }
  }
  return options
}

/** The verifier for one provider id, or null when this deployment does not offer it. */
export function signInVerifier(providerId: string, env: SignInEnv): SignInVerifier | null {
  const check = (options: Omit<Parameters<typeof verifyIdToken>[1], 'nonce' | 'now'>): SignInVerifier => ({
    verify: (token, nonce, now) => verifyIdToken(token, { ...options, nonce, now }),
  })
  if (providerId === 'google' && value(env.GOOGLE_CLIENT_ID)) {
    return check({ keys: googleKeys(), issuers: GOOGLE_ISSUERS, audience: value(env.GOOGLE_CLIENT_ID) })
  }
  if (providerId === 'microsoft' && value(env.MICROSOFT_CLIENT_ID)) {
    const issuer = microsoftIssuer(env.MICROSOFT_TENANT_ID)
    if (!issuer) return null
    const tenant = value(env.MICROSOFT_TENANT_ID).toLowerCase()
    return check({
      keys: remoteKeys(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`),
      issuers: [issuer], audience: value(env.MICROSOFT_CLIENT_ID), emailVerifiedClaim: 'xms_edov',
    })
  }
  if (providerId === 'apple' && value(env.APPLE_CLIENT_ID)) {
    return check({ keys: remoteKeys(APPLE_KEYS), issuers: [APPLE_ISSUER], audience: value(env.APPLE_CLIENT_ID) })
  }
  if (providerId === 'oidc' && value(env.OIDC_CLIENT_ID)) {
    const issuer = oidcIssuer(env.OIDC_ISSUER)
    if (!issuer) return null
    const audience = value(env.OIDC_CLIENT_ID)
    return {
      async verify(token, nonce, now) {
        const jwks = value(env.OIDC_JWKS_URL) || (await discover(issuer))?.jwks_uri
        if (!jwks) return { ok: false, problem: 'keys-unavailable' }
        return verifyIdToken(token, { keys: remoteKeys(jwks), issuers: [issuer], audience, nonce, now })
      },
    }
  }
  return null
}
