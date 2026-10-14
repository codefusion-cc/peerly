import { createIdentityRoutes } from '../packages/core/worker/identity.mjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearOidcJwksCache,
  resolveOidcProvider,
  verifyOidcToken,
} from '../packages/core/worker/oidc.mjs'
import { lookupRendezvous } from '../packages/core/worker/rendezvous.mjs'
import { issueLobbyIdentity, verifyLobbyIdentity } from '../packages/core/worker/lobbyIdentity.mjs'
import { DEVICE_TOKEN_MAX_AGE_MS, deviceSignInNonce } from '../src/auth/deviceToken.ts'
import { deriveUserId } from '../src/collab/userId.ts'

const b64url = bytes => Buffer.from(bytes).toString('base64url')
const jsonPart = value => b64url(new TextEncoder().encode(JSON.stringify(value)))

async function fixture({ issuedAt = Date.now(), bindTo, iss = 'https://accounts.google.com' } = {}) {
  const rsa = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const rsaJwk = await crypto.subtle.exportKey('jwk', rsa.publicKey)
  rsaJwk.kid = 'test-key'
  rsaJwk.alg = 'RS256'
  rsaJwk.use = 'sig'

  const device = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  const deviceJwk = await crypto.subtle.exportKey('jwk', device.publicKey)
  const deviceKeyId = `P-256:${deviceJwk.x}:${deviceJwk.y}`
  const now = Date.now()
  const claims = {
    iss,
    aud: 'client-id',
    sub: 'subject',
    email: 'user@example.com',
    email_verified: true,
    nonce: deviceSignInNonce(bindTo ?? deviceKeyId),
    iat: Math.floor(issuedAt / 1000),
    exp: Math.floor(issuedAt / 1000) + 3600,
  }
  const head = jsonPart({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
  const body = jsonPart(claims)
  const jwtSig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    rsa.privateKey,
    new TextEncoder().encode(`${head}.${body}`)
  )
  const token = `${head}.${body}.${b64url(jwtSig)}`
  const timestamp = now
  const nonce = 'request-nonce-0123456789'
  // Signed for a purpose no route accepts, so a test that forgets to sign for
  // its own route sees the rejection a stolen request would get.
  const proof = new TextEncoder().encode([
    'peerly-unrelated-purpose-v1',
    'google',
    deviceKeyId,
    String(timestamp),
    nonce,
  ].join('\n'))
  const requestSig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    device.privateKey,
    proof
  )
  return {
    token,
    rsaJwk,
    claims,
    headers: {
      authorization: `Bearer ${token}`,
      'x-peerly-provider': 'google',
      'x-peerly-device-key': deviceKeyId,
      'x-peerly-request-ts': String(timestamp),
      'x-peerly-request-nonce': nonce,
      'x-peerly-request-signature': b64url(requestSig),
    },
    devicePrivateKey: device.privateKey,
  }
}

afterEach(() => {
  clearOidcJwksCache()
  vi.restoreAllMocks()
})

describe('identity worker', () => {
  it('issues private discovery proofs, rejecting forgery, expiry and cross-origin replay', async () => {
    const { rsaJwk, headers, devicePrivateKey, token } = await fixture()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [rsaJwk] })))
    const proof = new TextEncoder().encode(['peerly-lobby-identity-v1', 'google',
      headers['x-peerly-device-key'], headers['x-peerly-request-ts'], headers['x-peerly-request-nonce']].join('\n'))
    const signature = b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, devicePrivateKey, proof))
    const env = { VITE_GOOGLE_CLIENT_ID: 'client-id', RENDEZVOUS_SECRET: 'test-rendezvous-secret',
      RENDEZVOUS_RATE_LIMITER: { limit: async () => ({ success: true }) } }
    const response = await issueLobbyIdentity(new Request('https://app.example/api/rendezvous/presence', {
      method: 'POST', headers: { ...headers, 'x-peerly-request-signature': signature },
    }), env)
    expect(response.status).toBe(200)
    const { certificate, ...identity } = await response.json()
    const decoded = Buffer.from(certificate.split('.')[0], 'base64url').toString()
    expect(decoded).not.toContain('user@example.com')
    expect(decoded).not.toContain(token)
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual(['deviceKeyId', 'expiresAt', 'issuedAt', 'rendezvousId', 'userId'])
    const verify = (body = certificate, origin = 'https://app.example') => verifyLobbyIdentity(
      new Request(`${origin}/api/rendezvous/verify`, { method: 'POST', body }), env)
    expect(await (await verify()).json()).toEqual(identity)
    const parts = certificate.split('.')
    const forged = jsonPart({ ...identity, deviceKeyId: 'attacker' }) + '.' + parts[1]
    expect((await verify(forged)).status).toBe(401)
    expect((await verify(certificate, 'https://other.example')).status).toBe(401)
    expect((await verify('a'.repeat(2049))).status).toBe(413)
    vi.spyOn(Date, 'now').mockReturnValue(identity.expiresAt + 1)
    expect((await verify()).status).toBe(401)
  })

  it('issues minimal app certificates and verifies signed history without allowing expired live identity', async () => {
    const { rsaJwk, headers, devicePrivateKey, token } = await fixture()
    const routes = createIdentityRoutes({ fetcher: async () => Response.json({ keys: [rsaJwk] }) })
    const proof = new TextEncoder().encode(['peerly-app-identity-v1', 'google', headers['x-peerly-device-key'],
      headers['x-peerly-request-ts'], headers['x-peerly-request-nonce']].join('\n'))
    const signature = b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, devicePrivateKey, proof))
    const env = { VITE_GOOGLE_CLIENT_ID: 'client-id', IDENTITY_SECRET: 'synthetic-identity-secret',
      IDENTITY_RATE_LIMITER: { limit: async () => ({ success: true }) } }
    const response = await routes.issue(new Request('https://app.example/api/identity/issue', { method: 'POST',
      headers: { ...headers, 'x-peerly-request-signature': signature } }), env)
    expect(response.status).toBe(200)
    const identity = await response.json()
    const payload = JSON.parse(Buffer.from(identity.certificate.split('.')[0], 'base64url').toString())
    expect(Object.keys(payload).sort()).toEqual(['deviceKeyId', 'expiresAt', 'issuedAt', 'userId'])
    expect(JSON.stringify(identity)).not.toContain(token)
    expect(JSON.stringify(identity)).not.toContain('user@example.com')
    const verify = (atTime, certificate = identity.certificate, origin = 'https://app.example') => routes.verify(
      new Request(`${origin}/api/identity/verify`, { method: 'POST', body: certificate,
        headers: atTime === undefined ? {} : { 'x-peerly-at-time': String(atTime) } }), env)
    expect((await verify()).status).toBe(200)
    expect((await verify(undefined, identity.certificate, 'https://other.example')).status).toBe(401)
    vi.spyOn(Date, 'now').mockReturnValue(identity.expiresAt + 1000)
    expect((await verify()).status).toBe(401)
    expect((await verify(identity.issuedAt)).status).toBe(200)
    expect((await verify(identity.issuedAt - 31_000)).status).toBe(401)
    expect((await verify(identity.issuedAt, identity.certificate + 'x')).status).toBe(401)
  })

  it('refuses to mint discovery identity for a stolen token without its device signature', async () => {
    const { rsaJwk, headers } = await fixture()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [rsaJwk] })))
    const response = await issueLobbyIdentity(new Request('https://app.example/api/rendezvous/presence', {
      method: 'POST', headers,
    }), { VITE_GOOGLE_CLIENT_ID: 'client-id', RENDEZVOUS_SECRET: 'test-secret',
      RENDEZVOUS_RATE_LIMITER: { limit: async () => ({ success: true }) } })
    expect(response.status).toBe(401)
  })
  it('rejects unsafe multi-tenant Microsoft configuration', () => {
    expect(resolveOidcProvider('microsoft', {
      VITE_MICROSOFT_CLIENT_ID: 'client',
      VITE_MICROSOFT_TENANT_ID: 'common',
    })).toBeNull()
  })

  it('returns stable opaque IDs only after device authentication and rate limiting', async () => {
    const { rsaJwk, headers, devicePrivateKey } = await fixture()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [rsaJwk] })))
    const email = 'target@example.com'
    const proof = new TextEncoder().encode([
      'peerly-rendezvous-lookup-v1',
      'google',
      headers['x-peerly-device-key'],
      headers['x-peerly-request-ts'],
      headers['x-peerly-request-nonce'],
      email,
    ].join('\n'))
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      devicePrivateKey,
      proof
    )
    const signedHeaders = { ...headers, 'x-peerly-request-signature': b64url(signature) }
    const env = {
      VITE_GOOGLE_CLIENT_ID: 'client-id',
      RENDEZVOUS_SECRET: 'rendezvous-secret-at-least-long-enough',
      RENDEZVOUS_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    }
    const makeRequest = () => new Request('https://app.example/api/rendezvous/lookup', {
      method: 'POST',
      headers: { ...signedHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const first = await lookupRendezvous(makeRequest(), env)
    const second = await lookupRendezvous(makeRequest(), env)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual(await second.json())
    expect(env.RENDEZVOUS_RATE_LIMITER.limit).toHaveBeenCalledTimes(2)

    env.RENDEZVOUS_RATE_LIMITER.limit.mockResolvedValueOnce({ success: false })
    await expect(lookupRendezvous(makeRequest(), env).then(response => response.status)).resolves.toBe(429)
  })

  it('accepts a device-bound token past Google’s exp for 30 days after iat, and refuses it after', async () => {
    const provider = resolveOidcProvider('google', { VITE_GOOGLE_CLIENT_ID: 'client-id' })
    const day = 24 * 60 * 60_000
    const old = await fixture({ issuedAt: Date.now() - 29 * day })
    const fetcher = async () => Response.json({ keys: [old.rsaJwk] })
    const deviceKeyId = old.headers['x-peerly-device-key']
    expect((await verifyOidcToken(old.token, provider, deviceKeyId, fetcher)).sub).toBe('subject')
    const tooOld = await fixture({ issuedAt: Date.now() - DEVICE_TOKEN_MAX_AGE_MS - 60_000 })
    await expect(verifyOidcToken(tooOld.token, provider, tooOld.headers['x-peerly-device-key'],
      async () => Response.json({ keys: [tooOld.rsaJwk] }))).rejects.toThrow('too-old')
  })

  it('refuses a token whose nonce names another device, even with that device’s signature', async () => {
    const provider = resolveOidcProvider('google', { VITE_GOOGLE_CLIENT_ID: 'client-id' })
    const stolen = await fixture({ bindTo: 'P-256:someone-elses-key-xxxxxxxxx:yyyyyyyyyyyyyyyyyyyyyyyyy' })
    await expect(verifyOidcToken(stolen.token, provider, stolen.headers['x-peerly-device-key'],
      async () => Response.json({ keys: [stolen.rsaJwk] }))).rejects.toThrow('device')
  })

  it('certifies the same user id for both of Google’s issuer spellings, the one the page derives', async () => {
    const ids = []
    for (const iss of ['https://accounts.google.com', 'accounts.google.com']) {
      const { rsaJwk, headers, devicePrivateKey } = await fixture({ iss })
      const routes = createIdentityRoutes({ fetcher: async () => Response.json({ keys: [rsaJwk] }) })
      const proof = new TextEncoder().encode(['peerly-app-identity-v1', 'google', headers['x-peerly-device-key'],
        headers['x-peerly-request-ts'], headers['x-peerly-request-nonce']].join('\n'))
      const signature = b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, devicePrivateKey, proof))
      const response = await routes.issue(new Request('https://app.example/api/identity/issue', { method: 'POST',
        headers: { ...headers, 'x-peerly-request-signature': signature } }), { VITE_GOOGLE_CLIENT_ID: 'client-id',
        IDENTITY_SECRET: 'synthetic-identity-secret', IDENTITY_RATE_LIMITER: { limit: async () => ({ success: true }) } })
      ids.push((await response.json()).userId)
    }
    expect(ids[0]).toBe(ids[1])
    expect(ids[0]).toBe(await deriveUserId('https://accounts.google.com', 'subject'))
  })

  it('caps a certificate issued from an old token at the token’s 30 days', async () => {
    const issuedAt = Date.now() - DEVICE_TOKEN_MAX_AGE_MS + 60_000
    const { rsaJwk, headers, devicePrivateKey } = await fixture({ issuedAt })
    const routes = createIdentityRoutes({ fetcher: async () => Response.json({ keys: [rsaJwk] }) })
    const proof = new TextEncoder().encode(['peerly-app-identity-v1', 'google', headers['x-peerly-device-key'],
      headers['x-peerly-request-ts'], headers['x-peerly-request-nonce']].join('\n'))
    const signature = b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, devicePrivateKey, proof))
    const env = { VITE_GOOGLE_CLIENT_ID: 'client-id', IDENTITY_SECRET: 'synthetic-identity-secret',
      IDENTITY_RATE_LIMITER: { limit: async () => ({ success: true }) } }
    const response = await routes.issue(new Request('https://app.example/api/identity/issue', { method: 'POST',
      headers: { ...headers, 'x-peerly-request-signature': signature } }), env)
    expect(response.status).toBe(200)
    const identity = await response.json()
    expect(identity.expiresAt).toBe(Math.floor(issuedAt / 1000) * 1000 + DEVICE_TOKEN_MAX_AGE_MS)
  })
})
