import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deriveMemberId, deriveOpaqueUserId, deriveScopeRouteId, mintCapability, mintCookie, verifyCapability, verifyCookie,
} from '@codefusion-cc/realtime'
import * as legacy from '../../packages/core/worker/realtime/crypto.mjs'
import worker from '../index.mjs'

/**
 * Devices signed in before the control plane moved onto @codefusion-cc/realtime
 * hold a capability and a network cookie minted by Peerly's own crypto
 * (packages/core/worker/realtime/crypto.mjs, deleted since). Their gateways
 * hold the sessions that code wrote. None of them may be signed out by the
 * move.
 *
 * The tokens below were minted by that code on 2026-10-14 for a test device
 * whose key is right here, with test-only secrets, and run to 2100. They are
 * frozen on purpose: a change to the token format that would sign every
 * device out turns this file red.
 */

const LEGACY = {
  secret: 'legacy-session-secret-0123456789abcdef',
  opaqueSecret: 'legacy-opaque-secret-0123456789abcdef',
  // Test-only device key: it signs nothing outside this file.
  device: {
    kty: 'EC', crv: 'P-256',
    x: 'MfKQpAE-d-HNiz5_FSZXSItj86FI1YKt8DcoCr0jA7I',
    y: '0IheOs1EQXDMpuQpd-rpphq-nZSe6M3xHfktKGtEXPA',
    d: 'mP_agICOdat4GfKczdCsksEaAEQx578_cM01-MUvrio',
  },
  deviceKeyId: 'P-256:MfKQpAE-d-HNiz5_FSZXSItj86FI1YKt8DcoCr0jA7I:0IheOs1EQXDMpuQpd-rpphq-nZSe6M3xHfktKGtEXPA',
  // deriveOpaqueUserId(opaqueSecret, 'peerly', 'https://accounts.google.com', '1234567890')
  uid: 'r8miPvRsmguSHsYIC06gdJgh1aLFEKHAGseioeUQWQ8',
  publicUserId: 'legacy-public-user-id',
  // derivePrivateMemberId(opaqueSecret, 'peerly', ' Ada@Example.com ')
  memberId: 'HckgCfLu94GuNs6BAf48dBRgFMZ_DwjR2WmKnh6GJrI',
  // deriveScopeRouteId(opaqueSecret, 'peerly', 'workspace', 'cap-abc')
  scopeRouteId: 'kXADTyXp0hyqLkYO7pg_vRyguHhsL34R5fpAgvEPfr8',
  sid: 'legacy-session-0001',
  iat: 1791936000000,
  exp: 4102444800000,
  capability: 'v1.eyJhcHAiOiJwZWVybHkiLCJ1aWQiOiJyOG1pUHZSc21ndVNIc1lJQzA2Z2RKZ2gxYUxGRUtIQUdzZWlvZVVRV1E4IiwidXNlciI6ImxlZ2FjeS1wdWJsaWMtdXNlci1pZCIsIm1lbWJlciI6Ikhja2dDZkx1OTRHdU5zNkJBZjQ4ZEJSZ0ZNWl9Ed2pSMldtS25oNkdKckkiLCJkayI6IlAtMjU2Ok1mS1FwQUUtZC1ITml6NV9GU1pYU0l0ajg2RkkxWUt0OERjb0NyMGpBN0k6MEloZU9zMUVRWERNcHVRcGQtcnBwaHEtblpTZTZNM3hIZmt0S0d0RVhQQSIsInNpZCI6ImxlZ2FjeS1zZXNzaW9uLTAwMDEiLCJlcG9jaCI6MCwiaWF0IjoxNzkxOTM2MDAwMDAwLCJleHAiOjQxMDI0NDQ4MDAwMDAsInZlciI6MX0.9n2GS2XOyJN84Ze5ghQRKZB1TLko5Q93kqs9fB0MfSI',
  cookie: 'v1.eyJhcHAiOiJwZWVybHkiLCJ1aWQiOiJyOG1pUHZSc21ndVNIc1lJQzA2Z2RKZ2gxYUxGRUtIQUdzZWlvZVVRV1E4IiwidXNlciI6ImxlZ2FjeS1wdWJsaWMtdXNlci1pZCIsIm1lbWJlciI6Ikhja2dDZkx1OTRHdU5zNkJBZjQ4ZEJSZ0ZNWl9Ed2pSMldtS25oNkdKckkiLCJkayI6IlAtMjU2Ok1mS1FwQUUtZC1ITml6NV9GU1pYU0l0ajg2RkkxWUt0OERjb0NyMGpBN0k6MEloZU9zMUVRWERNcHVRcGQtcnBwaHEtblpTZTZNM3hIZmt0S0d0RVhQQSIsInNpZCI6ImxlZ2FjeS1zZXNzaW9uLTAwMDEiLCJpYXQiOjE3OTE5MzYwMDAwMDAsImV4cCI6NDEwMjQ0NDgwMDAwMH0.dWzcStzWFIIYh36gifXWHm4WdPFMw_C6B2pNebsN9GE',
}

const ORIGIN = 'https://peerly.cc'
const legacyClaims = {
  app: 'peerly', uid: LEGACY.uid, publicUserId: LEGACY.publicUserId, deviceKeyId: LEGACY.deviceKeyId,
  sid: LEGACY.sid, now: LEGACY.iat, ttlMs: LEGACY.exp - LEGACY.iat,
}
const deployment = () => ({
  ...env, NETWORK_SESSION_SECRET: LEGACY.secret, OPAQUE_USER_ID_SECRET: LEGACY.opaqueSecret, CONTENT_BACKEND: 'p2p',
})

afterEach(() => vi.restoreAllMocks())

describe('tokens minted before the move', () => {
  it('were minted by the code they replace', async () => {
    expect(await legacy.mintCapability(LEGACY.secret, { ...legacyClaims, privateMemberId: LEGACY.memberId, epoch: 0 }))
      .toBe(LEGACY.capability)
    expect(await legacy.mintCookie(LEGACY.secret, { ...legacyClaims, privateMemberId: LEGACY.memberId }))
      .toBe(LEGACY.cookie)
    expect(await legacy.deriveOpaqueUserId(LEGACY.opaqueSecret, 'peerly', 'https://accounts.google.com', '1234567890'))
      .toBe(LEGACY.uid)
    expect(await legacy.derivePrivateMemberId(LEGACY.opaqueSecret, 'peerly', ' Ada@Example.com ')).toBe(LEGACY.memberId)
    expect(await legacy.deriveScopeRouteId(LEGACY.opaqueSecret, 'peerly', 'workspace', 'cap-abc')).toBe(LEGACY.scopeRouteId)
  })

  it('are the very tokens the package mints from the same claims', async () => {
    expect(await mintCapability(LEGACY.secret, { ...legacyClaims, memberId: LEGACY.memberId, epoch: 0 })).toBe(LEGACY.capability)
    expect(await mintCookie(LEGACY.secret, { ...legacyClaims, memberId: LEGACY.memberId })).toBe(LEGACY.cookie)
  })

  it('verify under the package with every claim intact', async () => {
    const now = Date.now()
    expect(await verifyCapability(LEGACY.secret, LEGACY.capability, { app: 'peerly', now })).toEqual({
      app: 'peerly', uid: LEGACY.uid, user: LEGACY.publicUserId, member: LEGACY.memberId, dk: LEGACY.deviceKeyId,
      sid: LEGACY.sid, epoch: 0, iat: LEGACY.iat, exp: LEGACY.exp, ver: 1,
    })
    expect(await verifyCookie(LEGACY.secret, LEGACY.cookie, { app: 'peerly', now })).toEqual({
      app: 'peerly', uid: LEGACY.uid, user: LEGACY.publicUserId, member: LEGACY.memberId, dk: LEGACY.deviceKeyId,
      sid: LEGACY.sid, iat: LEGACY.iat, exp: LEGACY.exp,
    })
  })

  it('keep verifying while the session secret rotates, and stop once the old one is dropped', async () => {
    const now = Date.now()
    const rotated = `a-newer-session-secret-0123456789:${LEGACY.secret}`
    expect(await verifyCapability(rotated, LEGACY.capability, { app: 'peerly', now })).not.toBeNull()
    expect(await verifyCookie(rotated, LEGACY.cookie, { app: 'peerly', now })).not.toBeNull()
    expect(await verifyCapability('a-newer-session-secret-0123456789', LEGACY.capability, { app: 'peerly', now })).toBeNull()
    expect(await verifyCookie('a-newer-session-secret-0123456789', LEGACY.cookie, { app: 'peerly', now })).toBeNull()
  })

  it('name the same account, member and signal scope under the package', async () => {
    expect(await deriveOpaqueUserId(LEGACY.opaqueSecret, 'peerly', 'https://accounts.google.com', '1234567890')).toBe(LEGACY.uid)
    expect(await deriveMemberId(LEGACY.opaqueSecret, 'peerly', ' Ada@Example.com ')).toBe(LEGACY.memberId)
    expect(await deriveScopeRouteId(LEGACY.opaqueSecret, 'peerly', 'workspace', 'cap-abc')).toBe(LEGACY.scopeRouteId)
  })
})

/** The account's gateway as the old code left it: the account, one session, the device's epoch. */
async function seedLegacyGateway() {
  const stub = env.USER_GATEWAYS.getByName(`peerly:${LEGACY.uid}`)
  await runInDurableObject(stub, (_instance, state) => {
    const sql = state.storage.sql
    sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'uid', LEGACY.uid)
    sql.exec('INSERT OR REPLACE INTO sessions (sid, dk, epoch, created_at, expires_at) VALUES (?, ?, 0, ?, ?)',
      LEGACY.sid, LEGACY.deviceKeyId, LEGACY.iat, LEGACY.exp)
    sql.exec('INSERT OR REPLACE INTO device_epochs (dk, epoch) VALUES (?, 0)', LEGACY.deviceKeyId)
  })
  return stub
}

const base64Url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

/** The headers the legacy device signs a session request with, as today's page does. */
async function legacyProof(purpose) {
  const key = await crypto.subtle.importKey('jwk', LEGACY.device, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const timestamp = Date.now()
  const nonce = crypto.randomUUID()
  const payload = [purpose, 'peerly', LEGACY.deviceKeyId, String(timestamp), nonce, ''].join('\n')
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(payload))
  return {
    'x-peerly-device-key': LEGACY.deviceKeyId,
    'x-peerly-request-ts': String(timestamp),
    'x-peerly-request-nonce': nonce,
    'x-peerly-request-signature': base64Url(signature),
  }
}

function waitFor(frames, match) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no matching frame')), 5_000)
    const poll = setInterval(() => {
      const frame = frames.find(match)
      if (!frame) return
      clearInterval(poll)
      clearTimeout(timer)
      resolve(frame)
    }, 5)
  })
}

describe('a device signed in before the move', () => {
  it('opens a session with its capability, gets a fresh cookie and its ICE servers', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      throw new Error(`Unexpected outbound request: ${input instanceof Request ? input.url : input}`)
    })
    await seedLegacyGateway()
    const response = await worker.fetch(new Request(`${ORIGIN}/api/network/session`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...await legacyProof('realtime-session-v1') },
      body: JSON.stringify({ capability: LEGACY.capability }),
    }), deployment(), {})

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.runtimeConfig).toEqual({ protocolVersion: 1 })
    // No TURN key in this deployment: the session still hands out Cloudflare's STUN.
    expect(body.ice.servers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }])
    const cookie = response.headers.get('set-cookie').split(';')[0].slice('pnet='.length)
    expect(await verifyCookie(LEGACY.secret, cookie, { app: 'peerly', now: Date.now() })).toMatchObject({
      uid: LEGACY.uid, dk: LEGACY.deviceKeyId, sid: LEGACY.sid, user: LEGACY.publicUserId, member: LEGACY.memberId,
    })
  })

  it('opens its control socket with the cookie it holds and completes the hello', async () => {
    await seedLegacyGateway()
    const response = await worker.fetch(new Request(`${ORIGIN}/api/realtime/control`, {
      headers: { origin: ORIGIN, upgrade: 'websocket', cookie: `pnet=${LEGACY.cookie}` },
    }), deployment(), {})

    expect(response.status).toBe(101)
    const ws = response.webSocket
    const frames = []
    ws.accept()
    ws.addEventListener('message', event => frames.push(JSON.parse(String(event.data))))
    // Exactly what today's page sends first (packages/core/src/app/realtimeClient.ts).
    ws.send(JSON.stringify({ v: 1, id: 'legacy-hello', type: 'hello', sentAt: Date.now(), payload: { version: 1 } }))
    const answer = await waitFor(frames, frame => frame.payload?.for === 'legacy-hello')
    expect(answer.type).toBe('ack')
    ws.close()
  })

  it('is refused once its session is gone, so the test above is not passing by accident', async () => {
    const stub = await seedLegacyGateway()
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('DELETE FROM sessions WHERE sid = ?', LEGACY.sid)
    })
    const response = await worker.fetch(new Request(`${ORIGIN}/api/network/session`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...await legacyProof('realtime-session-v1') },
      body: JSON.stringify({ capability: LEGACY.capability }),
    }), deployment(), {})
    expect(response.status).toBe(401)
  })
})
