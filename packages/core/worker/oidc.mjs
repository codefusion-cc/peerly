const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const MAX_TOKEN_BYTES = 16_000
const MAX_REQUEST_AGE_MS = 60_000
const JWKS_FRESH_MS = 5 * 60_000
const JWKS_STALE_MS = 24 * 60 * 60_000
const jwksCache = new Map()

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

function audienceMatches(aud, clientId) {
  return typeof aud === 'string' ? aud === clientId : Array.isArray(aud) && aud.includes(clientId)
}

function verifiedClaim(value) {
  return value === true || value === 'true'
}

function validJwks(value) {
  return value && Array.isArray(value.keys) && value.keys.every(key => key && typeof key === 'object')
}

async function loadJwks(url, fetcher, timestamp, forceRefresh = false) {
  const cached = jwksCache.get(url)
  if (!forceRefresh && cached && timestamp - cached.fetchedAt <= JWKS_FRESH_MS) return cached.value
  try {
    const response = await fetcher(url, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error('jwks unavailable')
    const value = await response.json()
    if (!validJwks(value)) throw new Error('invalid jwks')
    jwksCache.set(url, { value, fetchedAt: timestamp })
    return value
  } catch (error) {
    // A provider outage must not immediately disconnect every signed-in user.
    // Keep a bounded last-good set, but never beyond one day so revoked keys do
    // not remain trusted indefinitely.
    if (cached && timestamp - cached.fetchedAt <= JWKS_STALE_MS) return cached.value
    throw error
  }
}

export function clearOidcJwksCache() {
  jwksCache.clear()
}

export async function verifyOidcToken(token, provider, fetcher = fetch, now = Date.now()) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_BYTES) throw new Error('malformed token')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('malformed token')
  const header = JSON.parse(new TextDecoder().decode(base64UrlBytes(parts[0])))
  const claims = JSON.parse(new TextDecoder().decode(base64UrlBytes(parts[1])))
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('invalid algorithm')
  let jwks = await loadJwks(provider.jwksUrl, fetcher, now)
  let jwk = jwks.keys.find(key => key.kid === header.kid)
  // Providers rotate signing keys. A missing kid bypasses the fresh-cache TTL
  // once so a new key is usable immediately instead of after five minutes.
  if (!jwk) {
    jwks = await loadJwks(provider.jwksUrl, fetcher, now, true)
    jwk = jwks.keys.find(key => key.kid === header.kid)
  }
  if (!jwk) throw new Error('signing key not found')
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  )
  const nowSeconds = Math.floor(now / 1000)
  if (!valid || !provider.issuers.has(claims.iss) || !audienceMatches(claims.aud, provider.clientId)) {
    throw new Error('invalid token')
  }
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) throw new Error('expired token')
  if (typeof claims.iat === 'number' && claims.iat > nowSeconds + 60) throw new Error('future token')
  if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + 60) throw new Error('not active')
  if (!verifiedClaim(claims[provider.verifiedClaim])) throw new Error('unverified account')
  if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.iss !== 'string') throw new Error('invalid subject')
  return claims
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
  if (claims.nonce !== deviceKeyId) return null
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
