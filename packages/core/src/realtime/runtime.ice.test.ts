import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Trystero's own peer factory, by path: it is what turns a room's rtcConfig
// into an RTCPeerConnection, and is not exported.
import createTrysteroPeer from '../../../../node_modules/@trystero-p2p/core/dist/peer.mjs'
import { joinRoomByCode } from '../joinRoom'
import { CLOUDFLARE_STUN } from '@codefusion-cc/realtime-media/ice'
import { ICE_EXPIRY_MARGIN_MS } from './ice'
import { closeDurableObjectsTransport, currentIceServers, durableObjectsTurnAvailable } from './runtime'

/**
 * What the control session's ICE grants do to the peer connections of a room.
 * The control socket is a fake that only emits what RealtimeClient emits
 * (an 'ice' event per established or refreshed session, see
 * realtimeClient.test.ts); the room's peer connections are made by Trystero's
 * real peer factory, so a regression in how the servers reach them shows up.
 */

const APP = 'peerly'
const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const STUN = { urls: [...CLOUDFLARE_STUN.urls] }
const turn = (n: number) => ({
  urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'],
  username: `user-${n}`,
  credential: `credential-${n}`,
})

const control = vi.hoisted(() => ({
  sockets: [] as Array<{ events: EventTarget; connect: () => Promise<void>; close: () => void }>,
  connect: async () => {},
}))
vi.mock('./transport.js', () => ({
  selectDurableObjectsTransport: () => {
    const socket = { events: new EventTarget(), connect: () => control.connect(), close: vi.fn() }
    control.sockets.push(socket)
    return socket
  },
}))
const rooms = vi.hoisted(() => ({ configs: [] as Array<{ rtcConfig: RTCConfiguration }> }))
vi.mock('./signaling.js', () => ({
  joinDurableObjectsRoom: (config: { rtcConfig: RTCConfiguration }) => {
    rooms.configs.push(config)
    return { leave: async () => {} }
  },
}))

/** The session answering, as RealtimeClient reports it. */
const grant = (ice: unknown, socket = control.sockets.at(-1)) =>
  socket?.events.dispatchEvent(new CustomEvent('ice', { detail: ice }))

/** The ICE servers Trystero gives the next RTCPeerConnection of `room`. */
function nextPeerServers(room: { rtcConfig: RTCConfiguration }) {
  let servers: RTCIceServer[] | undefined
  class CapturingPeerConnection {
    constructor(config: RTCConfiguration) {
      servers = config.iceServers
      throw new Error('captured')
    }
  }
  expect(() => createTrysteroPeer(true, { rtcConfig: room.rtcConfig, rtcPolyfill: CapturingPeerConnection }))
    .toThrow('captured')
  return servers
}

async function join() {
  await joinRoomByCode({ strategy: 'durable-objects', appId: APP, roomId: 'room-1', env: { VITE_APP_ID: APP } })
  return rooms.configs.at(-1) as { rtcConfig: RTCConfiguration }
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  control.connect = async () => {}
})

afterEach(() => {
  closeDurableObjectsTransport()
  control.sockets.length = 0
  rooms.configs.length = 0
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ICE servers for a room\'s peer connections', () => {
  it('gives a new peer exactly the session\'s Cloudflare STUN and TURN, and nothing of Trystero\'s defaults', async () => {
    control.connect = async () => { grant({ servers: [STUN, turn(1)], ttlMs: HOUR }) }
    const room = await join()
    expect(nextPeerServers(room)).toEqual([STUN, turn(1)])
  })

  it('waits for the first grant when the session answers after the socket opened', async () => {
    const joining = join()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(rooms.configs).toHaveLength(0)
    grant({ servers: [STUN, turn(1)], ttlMs: HOUR })
    const room = await joining
    expect(nextPeerServers(room)).toEqual([STUN, turn(1)])
  })

  it('joins at once on Cloudflare STUN when the session answers with nothing usable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    control.connect = async () => { grant(undefined) }
    await join()
    expect(rooms.configs).toHaveLength(1)
    expect(nextPeerServers(rooms.configs[0])).toEqual([STUN])
  })

  it('joins on Cloudflare STUN after 10 seconds without a grant, and takes TURN as soon as one lands', async () => {
    const joining = join()
    await vi.advanceTimersByTimeAsync(9_999)
    expect(rooms.configs).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    const room = await joining
    expect(nextPeerServers(room)).toEqual([STUN])
    expect(durableObjectsTurnAvailable(APP)).toBe(false)

    grant({ servers: [STUN, turn(1)], ttlMs: HOUR })
    expect(nextPeerServers(room)).toEqual([STUN, turn(1)])
    expect(durableObjectsTurnAvailable(APP)).toBe(true)
  })

  it('hands peers who join a long-open room the renewed credentials, not the ones the room started with', async () => {
    control.connect = async () => { grant({ servers: [STUN, turn(1)], ttlMs: HOUR }) }
    const room = await join()
    const before = nextPeerServers(room)

    vi.setSystemTime(NOW + 20 * 60_000)
    grant({ servers: [STUN, turn(2)], ttlMs: HOUR })
    expect(nextPeerServers(room)).toEqual([STUN, turn(2)])
    // The peer that already connected keeps the servers it was made with.
    expect(before).toEqual([STUN, turn(1)])
  })

  it('stops handing out TURN a minute before it expires when no renewal came, and keeps STUN', async () => {
    control.connect = async () => { grant({ servers: [STUN, turn(1)], ttlMs: HOUR }) }
    const room = await join()

    vi.setSystemTime(NOW + HOUR - ICE_EXPIRY_MARGIN_MS - 1)
    expect(nextPeerServers(room)).toEqual([STUN, turn(1)])
    vi.setSystemTime(NOW + HOUR - ICE_EXPIRY_MARGIN_MS)
    expect(nextPeerServers(room)).toEqual([STUN])
    expect(durableObjectsTurnAvailable(APP)).toBe(false)
  })

  it('keeps the last good grant when a refresh brings something unusable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    control.connect = async () => { grant({ servers: [STUN, turn(1)], ttlMs: HOUR }) }
    const room = await join()

    grant({ servers: [{ urls: ['turn:relay.peerly.cc:3478'], username: 'u', credential: 'c' }], ttlMs: HOUR })
    grant(undefined)
    expect(nextPeerServers(room)).toEqual([STUN, turn(1)])
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith('[peerly] the session sent no usable ICE servers')
  })

  it('keeps TURN it still holds through a refresh that brings STUN alone, until it expires', async () => {
    control.connect = async () => { grant({ servers: [STUN, turn(1)], ttlMs: HOUR }) }
    const room = await join()
    vi.setSystemTime(NOW + 20 * 60_000)
    grant({ servers: [STUN] })
    expect(nextPeerServers(room)).toEqual([STUN, turn(1)])

    vi.setSystemTime(NOW + HOUR - ICE_EXPIRY_MARGIN_MS)
    expect(nextPeerServers(room)).toEqual([STUN])
    // Once the old TURN is gone, the next STUN-only refresh is taken as it is,
    // and a later TURN grant replaces it.
    grant({ servers: [STUN] })
    expect(nextPeerServers(room)).toEqual([STUN])
    grant({ servers: [STUN, turn(2)], ttlMs: HOUR })
    expect(nextPeerServers(room)).toEqual([STUN, turn(2)])
  })

  it('starts from nothing after the control socket closes, and the next session grants afresh', async () => {
    control.connect = async () => { grant({ servers: [STUN, turn(1)], ttlMs: HOUR }) }
    await join()
    closeDurableObjectsTransport(APP)
    expect(control.sockets[0].close).toHaveBeenCalledTimes(1)
    expect(currentIceServers(APP)).toEqual([STUN])

    control.connect = async () => { grant({ servers: [STUN, turn(2)], ttlMs: HOUR }) }
    const room = await join()
    expect(control.sockets).toHaveLength(2)
    expect(nextPeerServers(room)).toEqual([STUN, turn(2)])
    // The old socket's late events no longer reach this tab's grant.
    grant({ servers: [STUN, turn(9)], ttlMs: HOUR }, control.sockets[0])
    expect(nextPeerServers(room)).toEqual([STUN, turn(2)])
  })

  it('keeps each app\'s grant to itself', async () => {
    control.connect = async () => { grant({ servers: [STUN, turn(1)], ttlMs: HOUR }) }
    await join()
    expect(currentIceServers('other-app')).toEqual([STUN])
  })
})
