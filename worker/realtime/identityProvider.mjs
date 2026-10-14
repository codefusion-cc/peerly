import { resolveOidcProvider, verifyOidcToken } from '../../packages/core/worker/oidc.mjs'

/**
 * The ID token check `handleRealtimeRoute` runs on enroll: a token of a
 * provider this deployment configures, bound to the enrolling device by its
 * nonce and at most 30 days old (src/auth/deviceToken.ts). Null for a
 * provider it does not offer.
 */
export function identityProvider(providerId, env) {
  const provider = resolveOidcProvider(providerId, env)
  if (!provider) return null
  return {
    async verify(token, deviceKeyId, now) {
      try {
        return { ok: true, claims: await verifyOidcToken(token, provider, deviceKeyId, fetch, now) }
      } catch (error) {
        // `keys-unavailable` makes the package answer 503, so the device retries instead of signing out.
        return { ok: false, problem: error?.problem ?? 'invalid' }
      }
    },
  }
}
