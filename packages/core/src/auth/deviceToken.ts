/**
 * An ID token bound to a device key, as the page, its peers and the Worker accept it.
 *
 * Sign-in asks the provider for a token whose nonce names this device's key (`<deviceKeyId>.<random>`), and every
 * use of the token comes with a fresh signature by that key. So the token alone is worth nothing to whoever copies
 * it, and it does not have to die after the provider's hour: a redirect cannot renew it silently, and asking the
 * person to sign in every hour would make Peerly unusable. It is accepted until `DEVICE_TOKEN_MAX_AGE_MS` after the
 * provider issued it, then the device signs in again.
 *
 * Runs in the page and in the Worker (packages/core/worker/oidc.mjs): no browser or app imports.
 */
import { readIdTokenClaims, verifyIdToken, type IdTokenCheck, type KeySet } from '@codefusion-cc/google-sign-in'

/** How long after its `iat` a device-bound token is accepted. The owner's choice (2026-10-14): 30 days. */
export const DEVICE_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60_000

/** How far the provider's clock may run ahead of ours for `iat`. */
const CLOCK_SKEW_MS = 60_000

const RANDOM_BYTES = 16

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

/** A sign-in's nonce: the device key it binds the token to, and a random part only this sign-in knows. */
export function deviceSignInNonce(deviceKeyId: string): string {
  return `${deviceKeyId}.${base64Url(crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)))}`
}

/**
 * Whether a token's nonce binds it to `deviceKeyId`. Device key ids (`P-256:<x>:<y>`) hold no dot, so the key is
 * everything before the first one.
 *
 * Until R7 (Peerly realtime plan, 2026-10-14) a nonce that is the bare key id is accepted too: tokens from Google's
 * script, before redirect sign-in, carry that form, and devices keep them for up to 30 days after the deploy.
 * `LEGACY_NONCE_UNTIL` ends it on its own; R7 deletes the branch.
 */
export function nonceBindsDevice(nonce: unknown, deviceKeyId: string, now = Date.now()): boolean {
  if (typeof nonce !== 'string' || !deviceKeyId || deviceKeyId.includes('.')) return false
  if (nonce === deviceKeyId) return now < LEGACY_NONCE_UNTIL
  const dot = nonce.indexOf('.')
  return dot > 0 && nonce.slice(0, dot) === deviceKeyId && nonce.length - dot - 1 >= 16
}

/**
 * The last moment a token in the legacy form (nonce = device key id) is accepted: 30 days after the redirect
 * sign-in can first be deployed, so no token Google's script issued before it outlives it. Remove with R7.
 */
export const LEGACY_NONCE_UNTIL = Date.UTC(2026, 10, 15)

/** Until when a token issued at `iat` (seconds) is accepted, in milliseconds since the epoch. */
export function deviceTokenAcceptedUntil(iat: number): number {
  return iat * 1000 + DEVICE_TOKEN_MAX_AGE_MS
}

/** The outcome of `verifyDeviceIdToken`: beyond what any ID token is refused for, `device` (its nonce names another
 * key) and `too-old`. */
export type DeviceTokenCheck = IdTokenCheck | { ok: false; problem: 'device' | 'too-old' }

export interface DeviceTokenOptions {
  /** The issuer's keys. */
  keys: KeySet
  /** The issuers accepted, matched whole. */
  issuers: Iterable<string>
  /** This app's client id at the issuer. */
  audience: string
  /** The key the presenter proved it holds. */
  deviceKeyId: string
  /** The claim the issuer asserts a verified address in (default `email_verified`). */
  emailVerifiedClaim?: string
  /** The time it is checked for, in milliseconds: now, or a signed message's time. */
  now?: number
}

/**
 * Verifies a device-bound ID token: signature, issuer, audience, subject and verified address exactly as
 * `verifyIdToken` does, as of the moment the issuer signed it; then that its nonce names `deviceKeyId` and that it
 * is at most `DEVICE_TOKEN_MAX_AGE_MS` old. The provider's `exp` only has to come after `iat`.
 */
export async function verifyDeviceIdToken(token: string, options: DeviceTokenOptions): Promise<DeviceTokenCheck> {
  const now = options.now ?? Date.now()
  const unverified = readIdTokenClaims(token)
  const iat = unverified?.iat
  const nonce = unverified?.nonce
  if (typeof iat !== 'number' || !Number.isFinite(iat) || typeof nonce !== 'string') return { ok: false, problem: 'malformed' }
  if (!nonceBindsDevice(nonce, options.deviceKeyId, now)) return { ok: false, problem: 'device' }
  const check = await verifyIdToken(token, {
    keys: options.keys,
    issuers: [...options.issuers],
    audience: options.audience,
    nonce,
    now: iat * 1000,
    emailVerifiedClaim: options.emailVerifiedClaim,
  })
  if (!check.ok) return check
  if (check.claims.iat * 1000 > now + CLOCK_SKEW_MS) return { ok: false, problem: 'issued-at' }
  if (now > deviceTokenAcceptedUntil(check.claims.iat)) return { ok: false, problem: 'too-old' }
  return check
}
