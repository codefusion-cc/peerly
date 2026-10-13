// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveChannelCapability } from '../channelCapability'
import { joinDurableObjectsRoom } from './signaling'

const transport = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  requestScope: vi.fn(async () => ({ routeId: 'scope-route' })),
}))
vi.mock('./runtime.js', () => ({ getDurableObjectsTransport: () => transport }))
vi.mock('@trystero-p2p/core', () => ({ createTopicStrategy: (options: unknown) => options }))

type Handler = (topic: string, message: unknown) => void
type Strategy = {
  init(config: unknown): Promise<unknown>
  subscribeTopic(scope: unknown, topic: string, onMessage: Handler): () => void
  publishTopic(scope: unknown, topic: string, message: unknown): void
  unpublishTopic(scope: unknown): void
}
const strategy = joinDurableObjectsRoom as unknown as Strategy

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

const config = { durableObjects: { app: 'peerly', kind: 'room', capability: 'room-secret' } }
/** A room joined by its route id, so reopening only waits on the control socket. */
const routedConfig = { durableObjects: { ...config.durableObjects, routeId: 'known-route' } }

/** Joins a room whose first scope socket the server accepts. */
async function join(roomConfig: unknown = config) {
  const joining = strategy.init(roomConfig)
  await vi.waitFor(() => expect(sockets).toHaveLength(1))
  latest().accept()
  return joining
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', ScopeServerSocket)
  vi.spyOn(Math, 'random').mockReturnValue(1)
  sockets.length = 0
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
    const joining = strategy.init({ durableObjects: { app: 'peerly', kind: 'workspace', capability: secret } })
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    latest().accept()
    await joining
    expect(transport.requestScope).toHaveBeenCalledWith('workspace',
      await deriveChannelCapability(secret, 'signal:workspace'))
    expect(JSON.stringify(transport.requestScope.mock.calls)).not.toContain(secret)
  })
})

describe('a room whose scope restarts', () => {
  it('fails the join when the first socket is refused, and does not keep trying', async () => {
    const joining = strategy.init(config)
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    latest().refuse()
    await expect(joining).rejects.toThrow('Durable Objects signal socket failed')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets).toHaveLength(1)
  })

  it('reopens after the scope drops the socket, asks for the scope again and claims its topics again', async () => {
    const scope = await join()
    const received: unknown[] = []
    strategy.subscribeTopic(scope, 'peer-topic', (_, message) => received.push(message))
    expect(sockets[0].sent.at(-1)?.payload).toEqual({ subscribe: ['peer-topic'] })

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
    expect(latest().sent).toEqual([expect.objectContaining({ type: 'signal', payload: { subscribe: ['peer-topic'] } })])

    // An offer from a peer who joins after the restart reaches the room.
    latest().deliver('peer-topic', { offer: 'sdp' })
    expect(received).toEqual([{ offer: 'sdp' }])
    strategy.publishTopic(scope, 'peer-topic', 'announce')
    expect(latest().sent.at(-1)?.payload).toEqual({ topic: 'peer-topic', message: 'announce' })
  })

  it('drops what the room sends while the scope is away, without throwing', async () => {
    const scope = await join()
    sockets[0].drop()
    expect(() => strategy.publishTopic(scope, 'peer-topic', 'announce')).not.toThrow()
    expect(sockets[0].sent).toEqual([])
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
    await vi.advanceTimersByTimeAsync(0)

    latest().drop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(3)
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
    const scope = await join()
    sockets[0].drop()
    strategy.unpublishTopic(scope)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(transport.connect).toHaveBeenCalledTimes(1)
    expect(sockets).toHaveLength(1)
  })

  it('stops for good when the room is left while a reopening waits on the control plane', async () => {
    const scope = await join(routedConfig)
    let failConnect = (_: Error) => {}
    transport.connect.mockImplementation(() => new Promise((_, reject) => { failConnect = reject }))
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(transport.connect).toHaveBeenCalledTimes(2)
    strategy.unpublishTopic(scope)
    failConnect(new Error('control plane down'))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(transport.connect).toHaveBeenCalledTimes(2)
    expect(sockets).toHaveLength(1)
  })

  it('does not reopen a socket it closed itself on leaving', async () => {
    const scope = await join()
    strategy.unpublishTopic(scope)
    expect(sockets[0].closedWith).toEqual([1000, 'room left'])
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets).toHaveLength(1)
  })

  it('closes a socket that opens after the room was left during a reconnect', async () => {
    const scope = await join(routedConfig)
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(1_000)
    strategy.unpublishTopic(scope)
    latest().accept()
    await vi.advanceTimersByTimeAsync(0)
    expect(latest().closedWith).toEqual([1000, 'room left'])
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets).toHaveLength(2)
  })
})
