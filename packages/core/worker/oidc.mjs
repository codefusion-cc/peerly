import { GOOGLE_ISSUERS, GOOGLE_JWKS_URL, remoteKeys } from '@codefusion-cc/google-sign-in'
import { nonceBindsDevice, verifyDeviceIdToken } from '../dist/auth/deviceToken.js'

const MAX_TOKEN_BYTES = 16_000
const MAX_REQUEST_AGE_MS = 60_000

const base64UrlBytes = value => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

const nonEmpty = value => typeof value === 'string' && value.trim() ? value.trim() : undefined

export function resolveOidcProvider(providerId, env) {
  if (providerId === 'google') {
    const clientId = nonEmpty(env.VITE_GOOGLE_CLIENT_ID)
    return clientId ? {
      clientId,
      issuers: new Set(GOOGLE_ISSUERS),
      jwksUrl: GOOGLE_JWKS_URL,
      verifiedClaim: 'email_verified',
    } : null
  }
  if (providerId === 'microsoft') {
    const clientId = nonEmpty(env.VITE_MICROSOFT_CLIENT_ID)
    const tenant = nonEmpty(env.VITE_MICROSOFT_TENANT_ID)
    if (!clientId || !tenant || ['common', 'organizations', 'consumers'].includes(tenant.toLowerCase())) return null
    return {
      clientId,
      issuers: new Set([
        `https://login.microsoftonline.com/${tenant}/v2.0`,
        `https://sts.windows.net/${tenant}/`,
      ]),
      jwksUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/discovery/v2.0/keys`,
      verifiedClaim: 'xms_edov',
    }
  }
  if (providerId === 'apple') {
    const clientId = nonEmpty(env.VITE_APPLE_CLIENT_ID)
    return clientId ? {
      clientId,
      issuers: new Set(['https://appleid.apple.com']),
      jwksUrl: 'https://appleid.apple.com/auth/keys',
      verifiedClaim: 'email_verified',
    } : null
  }
  if (providerId === 'oidc') {
    const clientId = nonEmpty(env.VITE_OIDC_CLIENT_ID)
    const issuer = nonEmpty(env.VITE_OIDC_ISSUER)?.replace(/\/$/, '')
    if (!clientId || !issuer) return null
    return {
      clientId,
      issuers: new Set([issuer]),
      jwksUrl: nonEmpty(env.OIDC_JWKS_URL) ?? `${issuer}/.well-known/jwks.json`,
      verifiedClaim: nonEmpty(env.OIDC_EMAIL_VERIFIED_CLAIM) ?? 'email_verified',
    }
  }
  return null
}

/** Each `fetch`'s key sets by JWKS address: the Worker's one `fetch` in production, a test's own in tests. */
let keySets = new WeakMap()

function keysFor(url, fetcher) {
  let byUrl = keySets.get(fetcher)
  if (!byUrl) keySets.set(fetcher, byUrl = new Map())
  let keys = byUrl.get(url)
  if (!keys) byUrl.set(url, keys = remoteKeys(url, { fetch: (input, init) => fetcher(input, init) }))
  return keys
}

export function clearOidcJwksCache() {
  keySets = new WeakMap()
}

/**
 * Verifies an ID token bound to `deviceKeyId` (src/auth/deviceToken.ts): Google's or another provider's checks as
 * of when it was issued, a nonce naming that device, and an age under the shared maximum. The caller still checks
 * the device's signature over its request. Throws for any refusal.
 */
export async function verifyOidcToken(token, provider, deviceKeyId, fetcher = fetch, now = Date.now()) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_BYTES) throw new Error('malformed token')
  const check = await verifyDeviceIdToken(token, {
    keys: keysFor(provider.jwksUrl, fetcher),
    issuers: provider.issuers,
    audience: provider.clientId,
    deviceKeyId,
    emailVerifiedClaim: provider.verifiedClaim,
    now,
  })
  if (!check.ok) throw Object.assign(new Error(`refused token: ${check.problem}`), { problem: check.problem })
  return check.claims
}

/** Verify a device-bound signature over an endpoint-specific canonical payload. */
export async function verifyDevicePayload(headers, claims, payload, now = Date.now()) {
  const deviceKeyId = headers.get('x-peerly-device-key') ?? ''
  const timestamp = Number(headers.get('x-peerly-request-ts') ?? '')
  const nonce = headers.get('x-peerly-request-nonce') ?? ''
  const signature = headers.get('x-peerly-request-signature') ?? ''
  if (!/^P-256:[A-Za-z0-9_-]{20,}:[A-Za-z0-9_-]{20,}$/.test(deviceKeyId)) return null
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_REQUEST_AGE_MS) return null
  if (nonce.length < 16 || nonce.length > 128 || signature.length < 40 || signature.length > 256) return null
  if (!nonceBindsDevice(claims.nonce, deviceKeyId, now)) return null
  const [curve, x, y] = deviceKeyId.split(':')
  if (curve !== 'P-256' || !x || !y) return null
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x, y, ext: true, key_ops: ['verify'] },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64UrlBytes(signature),
      payload
    )
    return valid ? { deviceKeyId, timestamp, nonce } : null
  } catch {
    return null
  }
}
