import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { deriveScopeRouteId, identityIssueProof } from '@codefusion-cc/realtime'
import { deriveUserId } from '../../packages/core/dist/userId.js'
import { clearOidcJwksCache } from '../../packages/core/worker/oidc.mjs'
import { workspacePolicy } from './commands/content.test-fixtures.mjs'
import { createTestAccounts, openPageControlSocket } from '../testing/testAccounts.mjs'
import worker from '../index.mjs'

/**
 * Peerly's control plane through its own Worker, in workerd, with real
 * Durable Objects: sign-in through Peerly's identity provider, the control
 * socket, and the commands Peerly adds to the package's gateway. Only the
 * identity provider's keys are fakes.
 */

const ORIGIN = 'https://peerly.cc'
let accounts
let keysReachable
let keysAnswer

const deployment = (extra = {}) => ({ ...env, ...accounts.env, CONTENT_BACKEND: 'p2p', ...extra })
const call = (request, environment = deployment()) => worker.fetch(request, environment, {})
const signIn = (email, subject, environment = deployment()) =>
  accounts.signIn(request => call(request, environment), email, subject)

beforeAll(async () => {
  accounts = await createTestAccounts({ issuer: 'https://issuer.e2e.test', clientId: 'peerly-control-test', app: 'peerly', origin: ORIGIN })
})

function fakeIdentityProvider() {
  keysReachable = true
  keysAnswer = () => accounts.jwks()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = input instanceof Request ? input.url : String(input)
    if (url !== accounts.jwksUrl) throw new Error(`Unexpected outbound request: ${url}`)
    if (!keysReachable) throw new TypeError('Network connection lost.')
    return keysAnswer()
  })
}

afterEach(() => vi.restoreAllMocks())

const enroll = (device, token, environment = deployment()) =>
  accounts.enroll(request => call(request, environment), device, token)

/** A control socket as the page opens it. */
const controlSocket = (cookie, environment = deployment()) =>
  openPageControlSocket(request => call(request, environment), ORIGIN, cookie)

describe('signing in', () => {
  it('gives two people their own capability, cookie and control socket', async () => {
    fakeIdentityProvider()
    const alice = await signIn('alice@e2e.test', 'sub-alice')
    const bob = await signIn('bob@e2e.test', 'sub-bob')
    expect(alice.capability).not.toBe(bob.capability)
    expect(alice.cookie).not.toBe(bob.cookie)
    await controlSocket(alice.cookie)
    await controlSocket(bob.cookie)
  })

  it('refuses a token whose nonce names another device key', async () => {
    fakeIdentityProvider()
    const device = await accounts.createDevice()
    const token = await accounts.mintIdToken({ email: 'mallory@e2e.test', nonce: 'not-the-device-key', subject: 'sub-mallory' })
    expect((await enroll(device, token)).status).toBe(401)
  })

  it('asks the device to retry, not to sign in again, while the provider keys cannot be read', async () => {
    fakeIdentityProvider()
    // Keys read earlier are still trusted for a day; this is a Worker that has none yet.
    clearOidcJwksCache()
    keysReachable = false
    const device = await accounts.createDevice()
    const token = await accounts.mintIdToken({ email: 'outage@e2e.test', nonce: device.deviceKeyId, subject: 'sub-outage' })
    const response = await enroll(device, token)
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
  })

  it('treats a key answer that is not JSON as an outage too', async () => {
    fakeIdentityProvider()
    clearOidcJwksCache()
    keysAnswer = () => new Response('<html>Service unavailable</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    const device = await accounts.createDevice()
    const token = await accounts.mintIdToken({ email: 'outage-html@e2e.test', nonce: device.deviceKeyId, subject: 'sub-outage-html' })
    expect((await enroll(device, token)).status).toBe(503)
  })

  it('has no oidc provider where VITE_OIDC_* is unset', async () => {
    fakeIdentityProvider()
    const device = await accounts.createDevice()
    const token = await accounts.mintIdToken({ email: 'nobody@e2e.test', nonce: device.deviceKeyId, subject: 'sub-nobody' })
    expect((await enroll(device, token, { ...env, CONTENT_BACKEND: 'p2p' })).status).toBe(503)
  })

  it('refuses a control socket without a cookie, and every route from a foreign origin', async () => {
    const control = await call(new Request(`${ORIGIN}/api/realtime/control`, { headers: { origin: ORIGIN, upgrade: 'websocket' } }))
    expect(control.status).toBe(401)
    const foreign = await call(new Request(`${ORIGIN}/api/network/enroll`, {
      method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}',
    }))
    expect(foreign.status).toBe(403)
  })

  it('ends only the session its cookie names on logout', async () => {
    fakeIdentityProvider()
    const alice = await signIn('alice-logout@e2e.test', 'sub-alice-logout')
    const otherDevice = await signIn('alice-logout@e2e.test', 'sub-alice-logout')
    const response = await call(new Request(`${ORIGIN}/api/realtime/logout`, {
      method: 'POST', headers: { origin: ORIGIN, cookie: alice.cookie },
    }))
    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toMatch(/^pnet=; .*Max-Age=0/)
    expect((await call(await alice.establish())).status).toBe(401)
    expect((await call(await otherDevice.establish())).status).toBe(200)
  })
})

describe('signal scopes for Trystero rooms', () => {
  it('leases a scope to the asking device and admits only it to the scope socket', async () => {
    fakeIdentityProvider()
    const alice = await signIn('alice-scope@e2e.test', 'sub-alice-scope')
    const bob = await signIn('bob-scope@e2e.test', 'sub-bob-scope')
    const { command } = await controlSocket(alice.cookie)
    const before = Date.now()
    const answer = await command('scope.request', { kind: 'room', capability: 'room-capability' })
    expect(answer.type).toBe('ack')
    // The same route the old gateway derived, so rooms keep their scope across the deploy.
    expect(answer.payload.result.routeId).toBe(await deriveScopeRouteId(env.OPAQUE_USER_ID_SECRET, 'peerly', 'room', 'room-capability'))
    expect(answer.payload.result.expiresAt).toBeGreaterThanOrEqual(before + 10 * 60_000)

    const scope = cookie => call(new Request(`${ORIGIN}/api/realtime/signal/${answer.payload.result.routeId}`, {
      headers: { origin: ORIGIN, upgrade: 'websocket', cookie },
    }))
    const admitted = await scope(alice.cookie)
    expect(admitted.status).toBe(101)
    admitted.webSocket.accept()
    admitted.webSocket.close()
    expect((await scope(bob.cookie)).status).toBe(403)
  })

  it('refuses a scope kind outside the four the page uses', async () => {
    fakeIdentityProvider()
    const alice = await signIn('alice-kind@e2e.test', 'sub-alice-kind')
    const { command } = await controlSocket(alice.cookie)
    const answer = await command('scope.request', { kind: 'evil', capability: 'x' })
    expect(answer.type).toBe('error')
  })
})

describe('revoking a device from the devices page', () => {
  it('signs it out everywhere and keeps its old sign-in token from enrolling it again', async () => {
    fakeIdentityProvider()
    const laptop = await signIn('alice-devices@e2e.test', 'sub-alice-devices')
    const phone = await signIn('alice-devices@e2e.test', 'sub-alice-devices')
    const laptopSocket = await controlSocket(laptop.cookie)
    const { command } = await controlSocket(phone.cookie)

    const answer = await command('device.revoke', { deviceKeyId: laptop.device.deviceKeyId })
    expect(answer).toMatchObject({ type: 'ack', payload: { result: { deviceKeyId: laptop.device.deviceKeyId } } })
    await vi.waitFor(() => expect(laptopSocket.closed).toEqual([4001]))
    expect((await call(await laptop.establish())).status).toBe(401)
    expect((await call(await phone.establish())).status).toBe(200)
    // A sign-in token issued before the revocation cannot enroll it again; one issued since can.
    const mint = issuedAt => accounts.mintIdToken({
      email: 'alice-devices@e2e.test', nonce: laptop.device.deviceKeyId, subject: 'sub-alice-devices', issuedAt,
    })
    expect((await enroll(laptop.device, await mint(Date.now() - 60_000))).status).toBe(401)
    expect((await enroll(laptop.device, await mint(Date.now()))).status).toBe(200)
  })

  it('refuses a payload that names no device key', async () => {
    fakeIdentityProvider()
    const alice = await signIn('alice-revoke-bad@e2e.test', 'sub-alice-revoke-bad')
    const { command } = await controlSocket(alice.cookie)
    expect((await command('device.revoke', { deviceKeyId: 'not-a-key' })).type).toBe('error')
  })
})

describe('encrypted content on preview', () => {
  const preview = () => deployment({ CONTENT_BACKEND: 'durable-objects' })

  it('admits a listed member by the verified email of the session, and no one else', async () => {
    fakeIdentityProvider()
    const alice = await signIn('alice@e2e.test', 'sub-alice-content', preview())
    const mallory = await signIn('mallory@e2e.test', 'sub-mallory-content', preview())
    const { payload } = await workspacePolicy()

    const admitted = await (await controlSocket(alice.cookie, preview())).command('workspace.content.authorize', payload)
    expect(admitted.type).toBe('ack')
    expect(admitted.payload.result.routeId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const channel = await call(new Request(`${ORIGIN}/api/realtime/content/${admitted.payload.result.routeId}`, {
      headers: { origin: ORIGIN, upgrade: 'websocket', cookie: alice.cookie },
    }), preview())
    expect(channel.status).toBe(101)
    channel.webSocket.accept()
    channel.webSocket.close()

    const refused = await (await controlSocket(mallory.cookie, preview())).command('workspace.content.authorize', payload)
    expect(refused).toMatchObject({ type: 'error', payload: { code: 'auth-required' } })
  })
})

describe('identity certificates', () => {
  async function issue(person) {
    return call(new Request(`${ORIGIN}/api/realtime/identity`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: person.cookie, ...await person.device.proofHeaders(identityIssueProof('peerly')) },
    }))
  }

  it('certifies a live session and verifies what it issued', async () => {
    fakeIdentityProvider()
    const alice = await signIn('alice-identity@e2e.test', 'sub-alice-identity')
    const issued = await issue(alice)
    expect(issued.status).toBe(200)
    const certificate = await issued.json()
    expect(certificate).toMatchObject({ userId: await deriveUserId('https://issuer.e2e.test', 'sub-alice-identity'), deviceKeyId: alice.device.deviceKeyId })

    const verified = await call(new Request(`${ORIGIN}/api/identity/verify`, { method: 'POST', body: certificate.certificate }))
    expect(verified.status).toBe(200)
    expect(await verified.json()).toMatchObject({ userId: certificate.userId, deviceKeyId: alice.device.deviceKeyId })
  })

  it('refuses a session that has logged out, and a forged certificate', async () => {
    fakeIdentityProvider()
    const alice = await signIn('alice-identity-out@e2e.test', 'sub-alice-identity-out')
    await call(new Request(`${ORIGIN}/api/realtime/logout`, { method: 'POST', headers: { origin: ORIGIN, cookie: alice.cookie } }))
    expect((await issue(alice)).status).toBe(401)
    const forged = await call(new Request(`${ORIGIN}/api/identity/verify`, { method: 'POST', body: `${'a'.repeat(40)}.${'b'.repeat(43)}` }))
    expect(forged.status).toBe(401)
  })
})
