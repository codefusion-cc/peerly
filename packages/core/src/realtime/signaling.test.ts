// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveChannelCapability } from '../channelCapability'
import { joinDurableObjectsRoom } from './signaling'

const transport = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  requestScope: vi.fn(async () => ({ routeId: 'scope-route' })),
}))
vi.mock('./runtime.js', () => ({ getDurableObjectsTransport: () => transport }))

/**
 * Trystero, cut down to what it does with a topic strategy: it makes one relay
 * (`init`) for every room joined while any room is open, from the first room's
 * config, then subscribes each room's self and root topics on that relay and
 * unsubscribes them when the room leaves.
 */
type Handler = (topic: string, message: unknown) => void
type RoomContext = { appId: string; roomId: string }
type Adapter = {
  init(config: unknown): unknown
  subscribeTopic(relay: unknown, topic: string, onMessage: Handler, room: RoomContext): () => void
  publishTopic(relay: unknown, topic: string, message: unknown, room: RoomContext): void
}
const trystero = vi.hoisted(() => ({ adapter: null as unknown, relay: null as unknown, open: 0 }))
vi.mock('@trystero-p2p/core', () => ({
  createTopicStrategy: (adapter: unknown) => {
    trystero.adapter = adapter
    return (config: { appId: string }, roomId: string) => {
      const { init, subscribeTopic, publishTopic } = adapter as Adapter
      if (trystero.open === 0) trystero.relay = init(config)
      trystero.open += 1
      const room = { appId: config.appId, roomId }
      const received: unknown[] = []
      const offs = [`${roomId}/self`, `${roomId}/root`].map(topic =>
        subscribeTopic(trystero.relay, topic, (_, message) => received.push(message), room))
      let left = false
      return {
        received,
        send: (topic: string, message: unknown) => publishTopic(trystero.relay, topic, message, room),
        leave: () => {
          if (left) return
          left = true
          offs.forEach(off => off())
          trystero.open -= 1
        },
      }
    }
  },
}))
type Joined = { received: unknown[]; send(topic: string, message: unknown): void; leave(): void }

/** A browser WebSocket the test opens and closes the way the scope would. */
class ScopeServerSocket extends EventTarget {
  static all: ScopeServerSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3
  readyState = ScopeServerSocket.CONNECTING
  readonly sent: Array<{ type: string; payload: unknown }> = []
  closedWith: [number, string] | null = null
  constructor(readonly url: URL) {
    super()
    ScopeServerSocket.all.push(this)
  }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close(code: number, reason: string) {
    this.closedWith = [code, reason]
    this.readyState = ScopeServerSocket.CLOSED
  }
  accept() {
    this.readyState = ScopeServerSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }
  refuse() {
    this.readyState = ScopeServerSocket.CLOSED
    this.dispatchEvent(new Event('error'))
  }
  /** The Durable Object restarting: the server closes the socket. */
  drop() {
    this.readyState = ScopeServerSocket.CLOSED
    this.dispatchEvent(new CloseEvent('close', { code: 1006 }))
  }
  deliver(topic: string, message: unknown) {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ v: 1, id: 'f', type: 'signal', sentAt: 0, payload: { topic, message, from: 'peer' } }),
    }))
  }
}
const sockets = ScopeServerSocket.all
const latest = () => sockets.at(-1) as ScopeServerSocket

const scope = { app: 'peerly', kind: 'room', capability: 'room-secret' }
const config = { appId: 'peerly', durableObjects: scope }
/** A room joined by its route id, so reopening only waits on the control socket. */
const routedConfig = { appId: 'peerly', durableObjects: { ...scope, routeId: 'known-route' } }

const enter = (roomConfig: unknown, roomId: string) =>
  (joinDurableObjectsRoom as unknown as (config: unknown, roomId: string) => Joined)(roomConfig, roomId)

/** Joins a room whose first scope socket the server accepts. */
async function join(roomConfig: unknown = config, roomId = 'room-1') {
  const opened = sockets.length
  const room = enter(roomConfig, roomId)
  await vi.waitFor(() => expect(sockets).toHaveLength(opened + 1))
  latest().accept()
  await vi.advanceTimersByTimeAsync(0)
  return room
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', ScopeServerSocket)
  vi.spyOn(Math, 'random').mockReturnValue(1)
  sockets.length = 0
  trystero.open = 0
  transport.connect.mockReset()
  transport.connect.mockResolvedValue(undefined)
  transport.requestScope.mockReset()
  transport.requestScope.mockResolvedValue({ routeId: 'scope-route' })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Durable Objects signaling authorization', () => {
  it('never exposes the WebRTC or content encryption secret to scope.request', async () => {
    const secret = 'high-entropy-root-secret'
    await join({ appId: 'peerly', durableObjects: { app: 'peerly', kind: 'workspace', capability: secret } })
    expect(transport.requestScope).toHaveBeenCalledWith('workspace',
      await deriveChannelCapability(secret, 'signal:workspace'))
    expect(JSON.stringify(transport.requestScope.mock.calls)).not.toContain(secret)
  })
})

describe('rooms open at the same time', () => {
  it('signal each through its own scope, not the scope of the room that opened first', async () => {
    transport.requestScope.mockImplementation(async (_kind: string, capability: string) => ({ routeId: `route-of-${capability.slice(0, 8)}` }))
    const workspace = await join({ appId: 'peerly', durableObjects: { ...scope, capability: 'workspace-secret' } }, 'workspace')
    const dm = await join({ appId: 'peerly', durableObjects: { ...scope, capability: 'dm-secret' } }, 'dm')

    expect(transport.requestScope.mock.calls.map(call => call[1])).toEqual([
      await deriveChannelCapability('workspace-secret', 'signal:room'),
      await deriveChannelCapability('dm-secret', 'signal:room'),
    ])
    expect(sockets.map(socket => socket.url.pathname)).toEqual([
      `/api/realtime/signal/route-of-${(await deriveChannelCapability('workspace-secret', 'signal:room')).slice(0, 8)}`,
      `/api/realtime/signal/route-of-${(await deriveChannelCapability('dm-secret', 'signal:room')).slice(0, 8)}`,
    ])
    expect(sockets[0].sent.at(-1)?.payload).toEqual({ subscribe: ['workspace/self', 'workspace/root'] })
    expect(sockets[1].sent.at(-1)?.payload).toEqual({ subscribe: ['dm/self', 'dm/root'] })

    dm.send('dm/root', 'announce')
    expect(sockets[1].sent.at(-1)?.payload).toEqual({ topic: 'dm/root', message: 'announce' })
    expect(sockets[0].sent.some(frame => JSON.stringify(frame.payload).includes('announce'))).toBe(false)

    sockets[1].deliver('dm/self', { offer: 'sdp' })
    expect(dm.received).toEqual([{ offer: 'sdp' }])
    expect(workspace.received).toEqual([])
  })

  it('share one socket when they share a scope, which stays open until the last of them leaves', async () => {
    const first = await join(routedConfig, 'room-1')
    const second = enter(routedConfig, 'room-2')
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets).toHaveLength(1)
    expect(sockets[0].sent.at(-1)?.payload).toEqual({ subscribe: ['room-1/self', 'room-1/root', 'room-2/self', 'room-2/root'] })

    first.leave()
    expect(sockets[0].closedWith).toBeNull()
    expect(sockets[0].sent.at(-1)?.payload).toEqual({ subscribe: ['room-2/self', 'room-2/root'] })
    second.send('room-2/root', 'announce')
    expect(sockets[0].sent.at(-1)?.payload).toEqual({ topic: 'room-2/root', message: 'announce' })

    second.leave()
    expect(sockets[0].closedWith).toEqual([1000, 'room left'])
  })

  it('reopen the scope of a room left and rejoined while another room keeps the relay alive', async () => {
    await join({ appId: 'peerly', durableObjects: { ...scope, routeId: 'other-route' } }, 'other')
    const room = await join(routedConfig, 'room-1')
    room.leave()
    const rejoined = await join(routedConfig, 'room-1')
    expect(sockets.map(socket => socket.url.pathname)).toEqual([
      '/api/realtime/signal/other-route',
      '/api/realtime/signal/known-route',
      '/api/realtime/signal/known-route',
    ])
    expect(latest().sent.at(-1)?.payload).toEqual({ subscribe: ['room-1/self', 'room-1/root'] })
    latest().deliver('room-1/root', 'announce')
    expect(rejoined.received).toEqual(['announce'])
  })

  it('close the socket of a room left and rejoined, instead of keeping both open', async () => {
    const room = await join(routedConfig)
    room.leave()
    await join(routedConfig)
    expect(sockets).toHaveLength(2)
    expect(sockets[0].closedWith).toEqual([1000, 'room left'])
    expect(sockets[1].closedWith).toBeNull()
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets).toHaveLength(2)
  })
})

describe('a room whose scope restarts', () => {
  it('keeps trying when the first socket is refused, and claims its topics once one opens', async () => {
    const room = enter(routedConfig, 'room-1')
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    latest().refuse()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(2)
    latest().accept()
    await vi.advanceTimersByTimeAsync(0)
    expect(latest().sent).toEqual([expect.objectContaining({ payload: { subscribe: ['room-1/self', 'room-1/root'] } })])
    latest().deliver('room-1/root', 'announce')
    expect(room.received).toEqual(['announce'])
  })

  it('reopens after the scope drops the socket, asks for the scope again and claims its topics again', async () => {
    const room = await join()
    expect(sockets[0].sent.at(-1)?.payload).toEqual({ subscribe: ['room-1/self', 'room-1/root'] })

    transport.requestScope.mockResolvedValue({ routeId: 'scope-route-2' })
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(999)
    expect(transport.connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(sockets).toHaveLength(2))
    expect(transport.requestScope).toHaveBeenCalledTimes(2)
    expect(latest().url.pathname).toBe('/api/realtime/signal/scope-route-2')

    latest().accept()
    await vi.advanceTimersByTimeAsync(0)
    expect(latest().sent).toEqual([expect.objectContaining({ type: 'signal', payload: { subscribe: ['room-1/self', 'room-1/root'] } })])

    // An offer from a peer who joins after the restart reaches the room.
    latest().deliver('room-1/self', { offer: 'sdp' })
    expect(room.received).toEqual([{ offer: 'sdp' }])
    room.send('room-1/root', 'announce')
    expect(latest().sent.at(-1)?.payload).toEqual({ topic: 'room-1/root', message: 'announce' })
  })

  it('drops what the room sends while the scope is away, without throwing', async () => {
    const room = await join()
    const sent = sockets[0].sent.length
    sockets[0].drop()
    expect(() => room.send('room-1/root', 'announce')).not.toThrow()
    expect(sockets[0].sent).toHaveLength(sent)
  })

  it('backs off while the control plane cannot be reached, then recovers and starts over from a second', async () => {
    await join(routedConfig)
    transport.connect.mockRejectedValue(new Error('control plane down'))
    sockets[0].drop()

    // 1 s, 2 s, 5 s, 10 s, then every 30 s.
    for (const delay of [1_000, 2_000, 5_000, 10_000, 30_000, 30_000]) {
      const calls = transport.connect.mock.calls.length
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(transport.connect).toHaveBeenCalledTimes(calls)
      await vi.advanceTimersByTimeAsync(1)
      expect(transport.connect).toHaveBeenCalledTimes(calls + 1)
    }
    expect(sockets).toHaveLength(1)

    transport.connect.mockResolvedValue(undefined)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sockets).toHaveLength(2)
    expect(latest().url.pathname).toBe('/api/realtime/signal/known-route')
    latest().accept()
    await vi.advanceTimersByTimeAsync(30_000)

    latest().drop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(3)
  })

  it('keeps backing off when the scope accepts each reopened socket and drops it at once', async () => {
    await join(routedConfig)
    sockets[0].drop()
    // 1 s, 2 s, 5 s, 10 s, 30 s: each reopening opens and is dropped straight away.
    for (const delay of [1_000, 2_000, 5_000, 10_000, 30_000]) {
      const opened = sockets.length
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(sockets).toHaveLength(opened)
      await vi.advanceTimersByTimeAsync(1)
      expect(sockets).toHaveLength(opened + 1)
      latest().accept()
      await vi.advanceTimersByTimeAsync(0)
      latest().drop()
    }
  })

  it('keeps trying when a reopened socket is refused', async () => {
    await join(routedConfig)
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(1_000)
    latest().refuse()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sockets).toHaveLength(3)
  })

  it('spreads the reconnects of many rooms over the delay, never sooner than half of it', async () => {
    vi.mocked(Math.random).mockReturnValue(0)
    await join(routedConfig)
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(499)
    expect(sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets).toHaveLength(2)
  })

  it('stops for good once the room is left, even with a reconnect pending', async () => {
    const room = await join()
    sockets[0].drop()
    room.leave()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(transport.connect).toHaveBeenCalledTimes(1)
    expect(sockets).toHaveLength(1)
  })

  it('stops for good when the room is left while a reopening waits on the control plane', async () => {
    const room = await join(routedConfig)
    let failConnect = (_: Error) => {}
    transport.connect.mockImplementation(() => new Promise((_, reject) => { failConnect = reject }))
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(transport.connect).toHaveBeenCalledTimes(2)
    room.leave()
    failConnect(new Error('control plane down'))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(transport.connect).toHaveBeenCalledTimes(2)
    expect(sockets).toHaveLength(1)
  })

  it('does not reopen a socket it closed itself on leaving', async () => {
    const room = await join()
    room.leave()
    expect(sockets[0].closedWith).toEqual([1000, 'room left'])
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets).toHaveLength(1)
  })

  it('closes a socket that opens after the room was left during a reconnect', async () => {
    const room = await join(routedConfig)
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(1_000)
    room.leave()
    latest().accept()
    await vi.advanceTimersByTimeAsync(0)
    expect(latest().closedWith).toEqual([1000, 'room left'])
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets).toHaveLength(2)
  })
})
