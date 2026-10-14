import { GOOGLE_ISSUERS } from '@codefusion-cc/google-sign-in'
import { testGoogleIssuer, type TestGoogleIssuer } from '@codefusion-cc/google-sign-in/testing'
import fc from 'fast-check'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEVICE_TOKEN_MAX_AGE_MS,
  LEGACY_NONCE_UNTIL,
  deviceSignInNonce,
  nonceBindsDevice,
  verifyDeviceIdToken,
} from './deviceToken'

// From the spec: a token whose nonce names the presenting device's key is accepted for 30 days after Google issued
// it, past Google's own one-hour `exp`, and never for another device. Only Google's side is faked.

const DEVICE = 'P-256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'
const OTHER = 'P-256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ISSUED = Date.UTC(2026, 11, 1, 12)
const DAY = 24 * 60 * 60_000

let google: TestGoogleIssuer
beforeEach(async () => {
  google = await testGoogleIssuer({ now: () => ISSUED })
})

const check = (token: string, now: number, deviceKeyId = DEVICE) =>
  verifyDeviceIdToken(token, { keys: google.keys(), issuers: GOOGLE_ISSUERS, audience: google.clientId, deviceKeyId, now })
const problem = async (token: string, now: number, deviceKeyId = DEVICE) => {
  const result = await check(token, now, deviceKeyId)
  return result.ok ? 'accepted' : result.problem
}

describe('age', () => {
  it('accepts a token past Google’s exp, up to exactly 30 days after iat, and not a millisecond later', async () => {
    const token = await google.token({ nonce: deviceSignInNonce(DEVICE) })
    expect(await problem(token, ISSUED + 2 * 60 * 60_000)).toBe('accepted')
    expect(await problem(token, ISSUED + DEVICE_TOKEN_MAX_AGE_MS)).toBe('accepted')
    expect(await problem(token, ISSUED + DEVICE_TOKEN_MAX_AGE_MS + 1_000)).toBe('too-old')
    expect(DEVICE_TOKEN_MAX_AGE_MS).toBe(30 * DAY)
  })

  it('refuses a token issued more than a minute in the future, and allows a clock a little behind', async () => {
    const token = await google.token({ nonce: deviceSignInNonce(DEVICE) })
    expect(await problem(token, ISSUED - 59_000)).toBe('accepted')
    expect(await problem(token, ISSUED - 61_000)).toBe('issued-at')
  })

  it('refuses a token whose exp is not after its iat', async () => {
    const iat = Math.floor(ISSUED / 1000)
    const token = await google.token({ nonce: deviceSignInNonce(DEVICE), exp: iat })
    expect(await problem(token, ISSUED)).toBe('expired')
  })

  it('checks a signed message at its own time', async () => {
    const token = await google.token({ nonce: deviceSignInNonce(DEVICE) })
    expect(await problem(token, ISSUED + 10 * DAY)).toBe('accepted')
    expect(await problem(token, ISSUED + 31 * DAY)).toBe('too-old')
  })
})

describe('device binding', () => {
  it('refuses a token bound to another device, however fresh', async () => {
    const token = await google.token({ nonce: deviceSignInNonce(OTHER) })
    expect(await problem(token, ISSUED)).toBe('device')
  })

  it('refuses nonces that only look like this device’s', async () => {
    for (const nonce of [`${DEVICE}.`, `${DEVICE}.short`, `x${DEVICE}.${'r'.repeat(22)}`, `${DEVICE}x.${'r'.repeat(22)}`, '', DEVICE.slice(0, -1)]) {
      expect(await problem(await google.token({ nonce }), ISSUED), nonce).toBe('device')
    }
    expect(await problem(await google.token({ nonce: undefined }), ISSUED)).toBe('malformed')
  })

  it('accepts the legacy nonce (the bare key id) until the cutoff, then refuses it', async () => {
    const legacyIssued = LEGACY_NONCE_UNTIL - 2 * DAY
    google = await testGoogleIssuer({ now: () => legacyIssued })
    const token = await google.token({ nonce: DEVICE })
    expect(await problem(token, LEGACY_NONCE_UNTIL - 1)).toBe('accepted')
    expect(await problem(token, LEGACY_NONCE_UNTIL)).toBe('device')
  })

  it('a key id with a dot binds nothing', () => {
    expect(nonceBindsDevice('a.b.' + 'r'.repeat(22), 'a.b')).toBe(false)
    expect(nonceBindsDevice(deviceSignInNonce(DEVICE), '')).toBe(false)
  })

  it('every sign-in nonce binds its own device and no other (property)', () => {
    const keyId = fc.tuple(fc.base64String({ minLength: 20, maxLength: 60 }), fc.base64String({ minLength: 20, maxLength: 60 }))
      .map(([x, y]) => `P-256:${x.replace(/[=+/]/g, 'A')}:${y.replace(/[=+/]/g, 'B')}`)
    fc.assert(fc.property(keyId, keyId, (mine, theirs) => {
      const nonce = deviceSignInNonce(mine)
      expect(nonceBindsDevice(nonce, mine)).toBe(true)
      if (theirs !== mine) expect(nonceBindsDevice(nonce, theirs)).toBe(false)
    }))
  })

  it('two sign-ins of one device never share a nonce', () => {
    expect(new Set(Array.from({ length: 50 }, () => deviceSignInNonce(DEVICE))).size).toBe(50)
  })
})

describe('what any token is refused for still holds, at any age', () => {
  it('a forged signature, an unsigned token and an HMAC confusion', async () => {
    const nonce = deviceSignInNonce(DEVICE)
    expect(await problem(await google.token({ nonce }, { signedWith: 'stranger' }), ISSUED + DAY)).toBe('signature')
    expect(await problem(await google.token({ nonce }, { signedWith: 'none' }), ISSUED + DAY)).toBe('algorithm')
    expect(await problem(await google.token({ nonce }, { signedWith: 'hmac-public-key' }), ISSUED + DAY)).toBe('algorithm')
  })

  it('a key Google withdrew, another audience, another issuer, an unverified address', async () => {
    const nonce = deviceSignInNonce(DEVICE)
    const old = await google.token({ nonce })
    await google.rotate({ keepPrevious: false })
    expect(await problem(old, ISSUED + DAY)).toBe('unknown-key')
    expect(await problem(await google.token({ nonce, aud: 'someone-else', azp: 'someone-else' }), ISSUED)).toBe('audience')
    expect(await problem(await google.token({ nonce, iss: 'https://evil.example' }), ISSUED)).toBe('issuer')
    expect(await problem(await google.token({ nonce, email_verified: false }), ISSUED)).toBe('email-unverified')
  })

  it('a token that is not one', async () => {
    expect(await problem('not.a.token', ISSUED)).toBe('malformed')
    expect(await problem('x'.repeat(20_000), ISSUED)).toBe('malformed')
  })
})
