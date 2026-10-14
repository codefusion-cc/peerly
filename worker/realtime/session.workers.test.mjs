import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestAccounts } from '../../packages/core/worker/realtime/testAccounts.mjs'
import worker from '../index.mjs'

/**
 * Two people signing in to Peerly's own Worker, in workerd, with real
 * Durable Objects: what the control session hands each browser for its calls.
 * Only the outside services are fakes: the identity provider's keys and
 * Cloudflare Realtime's TURN key API.
 */

const ORIGIN = 'https://peerly.cc'
const TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys/turn-key-id/credentials/generate-ice-servers'
const CLOUDFLARE_STUN = { urls: ['stun:stun.cloudflare.com:3478'] }
const turnKey = { TURN_KEY_ID: 'turn-key-id', TURN_KEY_API_TOKEN: 'turn-api-token' }

let accounts
let turnApi
let issued

/** What Cloudflare's TURN API answers, per call: credentials unique to that call. */
function cloudflareTurn() {
  issued += 1
  return new Response(JSON.stringify({
    iceServers: [{
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:3478?transport=tcp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
      ],
      username: `user-${issued}`,
      credential: `credential-${issued}`,
    }],
  }), { status: 201, headers: { 'content-type': 'application/json' } })
}

const deployment = (extra = {}) => ({ ...env, ...accounts.env, CONTENT_BACKEND: 'p2p', ...extra })

const signIn = (environment, email, subject) =>
  accounts.signIn(request => worker.fetch(request, environment, {}), email, subject)

beforeAll(async () => {
  accounts = await createTestAccounts({ issuer: 'https://issuer.e2e.test', clientId: 'peerly-session-test', app: 'peerly', origin: ORIGIN })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function fakeOutside(turn = cloudflareTurn) {
  issued = 0
  turnApi = vi.fn(turn)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === accounts.jwksUrl) return accounts.jwks()
    if (url === TURN_API) return turnApi(input, init)
    throw new Error(`Unexpected outbound request: ${url}`)
  })
}

describe('ICE servers on the control session', () => {
  it('gives each of two people their own Cloudflare TURN credentials, valid for an hour', async () => {
    fakeOutside()
    const alice = await signIn(deployment(turnKey), 'alice@e2e.test', 'sub-alice')
    const bob = await signIn(deployment(turnKey), 'bob@e2e.test', 'sub-bob')

    for (const [person, n] of [[alice, 1], [bob, 2]]) {
      expect(person.session.ice.servers).toEqual([
        CLOUDFLARE_STUN,
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turn:turn.cloudflare.com:3478?transport=tcp',
            'turns:turn.cloudflare.com:5349?transport=tcp',
          ],
          username: `user-${n}`,
          credential: `credential-${n}`,
        },
      ])
      expect(person.session.ice.ttlMs).toBe(3_600_000)
    }
    // The key's API token goes to Cloudflare and nowhere else.
    const [, request] = turnApi.mock.calls[0]
    expect(request.headers.authorization).toBe('Bearer turn-api-token')
    expect(JSON.stringify([alice.session, bob.session])).not.toContain('turn-api-token')
  })

  it('renews the credentials on every session refresh', async () => {
    fakeOutside()
    const environment = deployment(turnKey)
    const alice = await signIn(environment, 'alice-refresh@e2e.test', 'sub-alice-refresh')
    const refreshed = await worker.fetch(await alice.establish(), environment, {})
    expect(refreshed.status).toBe(200)
    const { ice } = await refreshed.json()
    expect(ice.servers[1].username).toBe('user-2')
    expect(ice.servers[1].username).not.toBe(alice.session.ice.servers[1].username)
  })

  it('hands out STUN alone, and no expiry, without a TURN key', async () => {
    fakeOutside()
    const alice = await signIn(deployment(), 'alice-nokey@e2e.test', 'sub-alice-nokey')
    expect(alice.session.ice).toEqual({ servers: [CLOUDFLARE_STUN] })
    expect(turnApi).not.toHaveBeenCalled()
  })

  it('still signs in, on STUN, when Cloudflare refuses the key', async () => {
    fakeOutside(() => new Response('{"errors":[{"message":"Authentication error"}]}', { status: 401 }))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const alice = await signIn(deployment(turnKey), 'alice-refused@e2e.test', 'sub-alice-refused')
    expect(alice.session.ice).toEqual({ servers: [CLOUDFLARE_STUN] })
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^turn: .*STUN only$/))
  })

  it('still signs in, on STUN, when Cloudflare answers with servers that are not its own', async () => {
    fakeOutside(() => new Response(JSON.stringify({
      iceServers: [{ urls: ['turn:relay.peerly.cc:3478'], username: 'u', credential: 'c' }],
    }), { status: 201 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const alice = await signIn(deployment(turnKey), 'alice-foreign@e2e.test', 'sub-alice-foreign')
    expect(alice.session.ice).toEqual({ servers: [CLOUDFLARE_STUN] })
  })
})
