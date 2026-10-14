import { resolveOidcProvider, verifyOidcToken } from '../../packages/core/worker/oidc.mjs'

/** What `verifyOidcToken` throws when the provider's keys could not be read, rather than for a bad token. */
const KEYS_UNAVAILABLE = new Set(['jwks unavailable', 'invalid jwks'])

/**
 * Fetches the provider's keys. A request that never got an answer, and an
 * answer that is not JSON (an outage page), count as keys unavailable.
 */
async function fetchKeys(url, init) {
  let response
  try {
    response = await fetch(url, init)
  } catch {
    throw new Error('jwks unavailable')
  }
  if (!response.ok) return response
  const text = await response.text()
  try {
    JSON.parse(text)
  } catch {
    throw new Error('jwks unavailable')
  }
  return new Response(text, response)
}

/**
 * The ID token check `handleRealtimeRoute` runs on enroll: a token of a
 * provider this deployment configures, bound to the enrolling device by its
 * `nonce`. Null for a provider it does not offer.
 *
 * `verifyOidcToken` already refuses a token whose provider does not vouch for
 * the email (each provider says so in its own claim), so an accepted one is
 * passed on as `email_verified`, which is what the package reads.
 */
export function identityProvider(providerId, env) {
  const provider = resolveOidcProvider(providerId, env)
  if (!provider) return null
  return {
    async verify(token, nonce, now) {
      let claims
      try {
        claims = await verifyOidcToken(token, provider, fetchKeys, now)
      } catch (error) {
        // A provider outage must not sign the device out: the package answers 503 and it retries.
        return { ok: false, problem: KEYS_UNAVAILABLE.has(error?.message) ? 'keys-unavailable' : 'invalid' }
      }
      if (claims.nonce !== nonce) return { ok: false, problem: 'nonce' }
      return { ok: true, claims: { ...claims, email_verified: true } }
    },
  }
}
