import { abortAllDurableObjects, evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestAccounts } from '../testing/testAccounts.mjs'
import worker from '../index.mjs'

/**
 * Two people calling each other through Peerly's own Worker, in workerd, with
 * real Durable Objects: each signs in and gets Cloudflare TURN, both reach
 * the same signalling scope, and the offer and answer that start a call pass
 * between them. Then what happens to a call around it: one of them leaves
 * and comes back, the scope hibernates, the scope restarts (every deploy
 * restarts it). Only the identity provider's keys and Cloudflare's TURN API
 * are fakes.
 */

const ORIGIN = 'https://peerly.cc'
const TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys/turn-key-id/credentials/generate-ice-servers'

let accounts
let issued = 0

const deployment = () => ({
  ...env,
  ...accounts.env,
  CONTENT_BACKEND: 'p2p',
  TURN_KEY_ID: 'turn-key-id',
  TURN_KEY_API_TOKEN: 'turn-api-token',
})

beforeAll(async () => {
  accounts = await createTestAccounts({ issuer: 'https://issuer.e2e.test', clientId: 'peerly-call-test', app: 'peerly', origin: ORIGIN })
})

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === accounts.jwksUrl) return accounts.jwks()
    if (url === TURN_API) {
      issued += 1
      return Response.json({
        iceServers: [{
          urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'],
          username: `user-${issued}`,
          credential: `credential-${issued}`,
        }],
      }, { status: 201 })
    }
    throw new Error(`Unexpected outbound request: ${url}`)
  })
})

afterEach(() => vi.restoreAllMocks())

/** A WebSocket from the browser's side: what arrived, and whether it closed. */
async function connect(path, cookie) {
  const response = await worker.fetch(new Request(new URL(path, ORIGIN), {
    headers: { origin: ORIGIN, upgrade: 'websocket', cookie },
  }), deployment(), {})
  expect(response.status).toBe(101)
  const ws = response.webSocket
  const socket = { ws, frames: [], closed: null }
  ws.accept()
  ws.addEventListener('message', event => { socket.frames.push(JSON.parse(String(event.data))) })
  ws.addEventListener('close', event => { socket.closed = event.code })
  socket.send = (type, payload) =>
    ws.send(JSON.stringify({ v: 1, id: crypto.randomUUID(), type, sentAt: Date.now(), payload }))
  socket.waitFor = async (match) => {
    let found
    await vi.waitFor(() => {
      found = socket.frames.find(match)
      expect(found).toBeDefined()
    })
    socket.frames.splice(socket.frames.indexOf(found), 1)
    return found
  }
  return socket
}

/** A signed-in person with a control socket, as a browser tab has. */
async function person(name) {
  const signedIn = await accounts.signIn(
    request => worker.fetch(request, deployment(), {}), `${name}@e2e.test`, `sub-${name}`
  )
  const control = await connect('/api/realtime/control', signedIn.cookie)
  control.send('hello', { version: 1 })
  await control.waitFor(frame => frame.type === 'ack')
  return { ...signedIn, control }
}

/** Asks the control plane for the room's scope, as `transport.requestScope` does. */
async function requestScope(who, capability) {
  const id = crypto.randomUUID()
  who.control.ws.send(JSON.stringify({
    v: 1, id, type: 'scope.request', sentAt: Date.now(), payload: { kind: 'room', capability },
  }))
  const ack = await who.control.waitFor(frame => frame.type === 'ack' && frame.payload?.for === id)
  return ack.payload.result.routeId
}

/** Joins the room's scope: authorization, then the signal socket. */
async function joinScope(who, capability) {
  const routeId = await requestScope(who, capability)
  return { routeId, socket: await connect(`/api/realtime/signal/${routeId}`, who.cookie) }
}

/** Alice offers, Bob answers, each addressed by the id the scope stamped. */
async function offerAndAnswer(alice, bob) {
  alice.send('signal', { topic: 'room-topic', message: { type: 'offer', sdp: 'alice-offer' } })
  const offer = await bob.waitFor(frame => frame.type === 'signal' && frame.payload.message?.type === 'offer')
  expect(offer.payload.message).toEqual({ type: 'offer', sdp: 'alice-offer' })

  bob.send('signal', { to: offer.payload.from, topic: 'room-topic', message: { type: 'answer', sdp: 'bob-answer' } })
  const answer = await alice.waitFor(frame => frame.type === 'signal' && frame.payload.message?.type === 'answer')
  expect(answer.payload.message).toEqual({ type: 'answer', sdp: 'bob-answer' })
}

describe('a call between two people', () => {
  it('signs both in with their own Cloudflare TURN, and carries the offer and answer between them', async () => {
    const alice = await person('alice-call')
    const bob = await person('bob-call')
    expect(alice.session.ice.servers[1].username).not.toBe(bob.session.ice.servers[1].username)
    for (const who of [alice, bob]) {
      expect(who.session.ice.servers.flatMap(server => server.urls))
        .toContain('turns:turn.cloudflare.com:5349?transport=tcp')
    }

    const aliceScope = await joinScope(alice, 'call-room-capability')
    const bobScope = await joinScope(bob, 'call-room-capability')
    expect(bobScope.routeId).toBe(aliceScope.routeId)
    await aliceScope.socket.waitFor(frame => frame.type === 'peer.join')

    await offerAndAnswer(aliceScope.socket, bobScope.socket)
  })

  it('keeps a stranger with another room\'s capability out of the call', async () => {
    const alice = await person('alice-private')
    const mallory = await person('mallory-private')
    const aliceScope = await joinScope(alice, 'private-room-capability')
    const elsewhere = await requestScope(mallory, 'another-capability')
    expect(elsewhere).not.toBe(aliceScope.routeId)

    const refused = await worker.fetch(new Request(new URL(`/api/realtime/signal/${aliceScope.routeId}`, ORIGIN), {
      headers: { origin: ORIGIN, upgrade: 'websocket', cookie: mallory.cookie },
    }), deployment(), {})
    expect(refused.status).toBe(403)
  })

  it('tells the one who stays when the other leaves, and lets the other back in', async () => {
    const alice = await person('alice-leave')
    const bob = await person('bob-leave')
    const aliceScope = await joinScope(alice, 'leave-room-capability')
    const bobScope = await joinScope(bob, 'leave-room-capability')
    const joined = await aliceScope.socket.waitFor(frame => frame.type === 'peer.join')

    bobScope.socket.ws.close(1000, 'room left')
    const left = await aliceScope.socket.waitFor(frame => frame.type === 'peer.leave')
    expect(left.payload.from).toBe(joined.payload.from)

    const back = await joinScope(bob, 'leave-room-capability')
    const rejoined = await aliceScope.socket.waitFor(frame => frame.type === 'peer.join')
    expect(rejoined.payload.from).not.toBe(joined.payload.from)
    await offerAndAnswer(aliceScope.socket, back.socket)
  })

  it('keeps a call\'s signalling through the scope hibernating', async () => {
    const alice = await person('alice-hibernate')
    const bob = await person('bob-hibernate')
    const aliceScope = await joinScope(alice, 'hibernate-room-capability')
    const bobScope = await joinScope(bob, 'hibernate-room-capability')
    await aliceScope.socket.waitFor(frame => frame.type === 'peer.join')

    const scope = env.SIGNAL_SCOPES.getByName(`peerly:${aliceScope.routeId}`)
    await runInDurableObject(scope, instance => { instance.beforeHibernating = true })
    await evictDurableObject(scope)
    expect(aliceScope.socket.closed).toBeNull()

    // Woken by the offer with nothing in memory: who is in the room comes
    // back from the sockets themselves.
    await offerAndAnswer(aliceScope.socket, bobScope.socket)
    expect(await runInDurableObject(scope, instance => instance.beforeHibernating)).toBeUndefined()
  })

  it('lets both back into the same scope after it restarts, as a deploy restarts it', async () => {
    const alice = await person('alice-restart')
    const bob = await person('bob-restart')
    const aliceScope = await joinScope(alice, 'restart-room-capability')
    const bobScope = await joinScope(bob, 'restart-room-capability')
    await aliceScope.socket.waitFor(frame => frame.type === 'peer.join')

    await abortAllDurableObjects()
    await vi.waitFor(() => {
      expect(aliceScope.socket.closed).not.toBeNull()
      expect(bobScope.socket.closed).not.toBeNull()
    })

    // What each browser does on its own (signaling.ts): open the control
    // socket again if it fell too, ask for the scope again, reopen.
    for (const who of [alice, bob]) {
      who.control = await connect('/api/realtime/control', who.cookie)
      who.control.send('hello', { version: 1 })
      await who.control.waitFor(frame => frame.type === 'ack')
    }
    const aliceAgain = await joinScope(alice, 'restart-room-capability')
    const bobAgain = await joinScope(bob, 'restart-room-capability')
    expect(aliceAgain.routeId).toBe(aliceScope.routeId)
    expect(bobAgain.routeId).toBe(bobScope.routeId)
    await aliceAgain.socket.waitFor(frame => frame.type === 'peer.join')
    await offerAndAnswer(aliceAgain.socket, bobAgain.socket)
  })
})
