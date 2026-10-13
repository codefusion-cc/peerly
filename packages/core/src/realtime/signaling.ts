import {
  createTopicStrategy,
  type BaseRoomConfig,
  type JoinRoom,
  type StrategyMessage,
} from '@trystero-p2p/core'
import { createIdSource, decodeFrame, encodeFrame } from '../protocol/index.js'
import { getDurableObjectsTransport } from './runtime.js'
import { deriveChannelCapability } from '../channelCapability.js'
import type { ScopeKind } from './types.js'

type DurableObjectsRoomConfig = BaseRoomConfig & {
  appId: string
  durableObjects: {
    app: string
    kind: ScopeKind
    capability: string
    routeId?: string
  }
}

type TopicHandler = (topic: string, message: StrategyMessage) => void | Promise<void>

/** Frame ids only need to be unique per socket; the scope never replays them. */
const ids = createIdSource()

/**
 * Waits before each attempt to reopen a lost scope socket. A deploy restarts
 * every Durable Object at once, so the delays are spread out (see `jitter`)
 * instead of bringing every open room back in the same second.
 */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
const jitter = (ms: number) => Math.round(ms * (0.5 + Math.random() / 2))
/**
 * How long a reopened socket must stay open before the next loss starts the
 * delays over. A scope that accepts a socket and drops it at once (a rate
 * limit, a refused frame) must keep backing off, not return every second.
 */
const STABLE_MS = 30_000
/**
 * What a room sends while its socket is opening or reopening waits for it, up
 * to this many messages and this long. Trystero announces a room the moment it
 * joins, before its socket can be open; losing that announcement leaves the
 * room unseen until the next one, and a room left and joined again in that
 * window cuts its first peer connections off half made. Anything older than
 * the wait is stale: Trystero announces again every few seconds.
 */
const PENDING_LIMIT = 32
const PENDING_MAX_AGE_MS = 5_000

type ScopeConfig = DurableObjectsRoomConfig['durableObjects']

/**
 * One socket into one Durable Object scope, shared by every room of this tab
 * that signals through that scope, and closed when the last of them leaves.
 */
class ScopeSocket {
  private readonly handlers = new Map<string, Set<TopicHandler>>()
  private socket: WebSocket | null = null
  private readonly config: ScopeConfig
  private left = false
  private attempts = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private stable: ReturnType<typeof setTimeout> | undefined
  private pending: Array<{ room: string; topic: string; message: StrategyMessage; at: number }> = []

  constructor(config: ScopeConfig) {
    this.config = config
    // A first opening that fails is retried like a lost socket: the rooms on
    // it are already joined, and find their peers once it opens.
    this.open().catch(() => this.reconnect())
  }

  get idle(): boolean {
    return this.handlers.size === 0
  }

  private async open(): Promise<void> {
    const transport = getDurableObjectsTransport(this.config.app)
    await transport.connect()
    // Asked again on every opening: the scope may have been reset since the
    // last one, and a fresh authorization is what lets this socket back in.
    const routeId = this.config.routeId ?? (
      await transport.requestScope(
        this.config.kind,
        await deriveChannelCapability(this.config.capability, `signal:${this.config.kind}`)
      )
    ).routeId
    if (!routeId) throw new Error('Durable Objects scope authorization failed')
    if (this.left) return

    const url = new URL(`/api/realtime/signal/${encodeURIComponent(routeId)}`, location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    socket.addEventListener('message', event => {
      const frame = decodeFrame(String(event.data))
      if (frame?.type !== 'signal' || !frame.payload || typeof frame.payload !== 'object') return
      const payload = frame.payload as { topic?: unknown; message?: unknown }
      if (typeof payload.topic !== 'string') return
      if (typeof payload.message !== 'string' &&
          (!payload.message || typeof payload.message !== 'object' || Array.isArray(payload.message))) return
      for (const handler of this.handlers.get(payload.topic) ?? []) {
        void handler(payload.topic, payload.message as StrategyMessage)
      }
    })
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('Durable Objects signal socket failed')), { once: true })
      socket.addEventListener('close', () => reject(new Error('Durable Objects signal socket closed')), { once: true })
    })
    if (this.left) {
      socket.close(1000, 'room left')
      return
    }
    this.socket = socket
    this.stable = setTimeout(() => { this.attempts = 0 }, STABLE_MS)
    // A Durable Object restart (every deploy is one) closes the socket while
    // the room is still open. Peers that are already connected keep talking
    // directly; reopening lets new ones find this room again, through the
    // announcements Trystero keeps repeating.
    socket.addEventListener('close', () => {
      clearTimeout(this.stable)
      this.socket = null
      this.reconnect()
    })
    if (this.handlers.size > 0) this.claimTopics()
    const fresh = Date.now() - PENDING_MAX_AGE_MS
    const pending = this.pending
    this.pending = []
    for (const { room, topic, message, at } of pending) {
      if (at >= fresh) this.send(room, topic, message)
    }
  }

  private reconnect(): void {
    if (this.left) return
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)]
    this.attempts += 1
    this.retry = setTimeout(() => {
      this.open().catch(() => this.reconnect())
    }, jitter(delay))
  }

  subscribe(topic: string, onMessage: TopicHandler): () => void {
    const handlers = this.handlers.get(topic) ?? new Set<TopicHandler>()
    handlers.add(onMessage)
    this.handlers.set(topic, handlers)
    this.claimTopics()
    return () => {
      handlers.delete(onMessage)
      if (handlers.size === 0 && this.handlers.get(topic) === handlers) this.handlers.delete(topic)
      this.claimTopics()
    }
  }

  /** Sends what `room` says on `topic`, or holds it until the socket opens. */
  send(room: string, topic: string, message: StrategyMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.pending.push({ room, topic, message, at: Date.now() })
      if (this.pending.length > PENDING_LIMIT) this.pending.shift()
      return
    }
    this.socket.send(encodeFrame('signal', { id: ids.next(), payload: { topic, message } }))
  }

  /**
   * Drops what a room that left held for the socket: its announcements would
   * draw offers to topics nobody listens on any more.
   */
  forget(room: string): void {
    this.pending = this.pending.filter(held => held.room !== room)
  }

  /**
   * Tell the scope which topics this participant listens on, so offers,
   * answers and ICE addressed to one peer are delivered to that peer instead
   * of broadcast to the whole room. Re-sent on every change, and on every
   * reopened socket, because the scope keeps the claim on the socket, not in
   * storage.
   */
  private claimTopics(): void {
    if (this.left || this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(encodeFrame('signal', { id: ids.next(), payload: { subscribe: [...this.handlers.keys()] } }))
  }

  close(): void {
    this.left = true
    clearTimeout(this.retry)
    clearTimeout(this.stable)
    this.handlers.clear()
    this.socket?.close(1000, 'room left')
    this.socket = null
  }
}

/** The scope each joined room signals through, by app id and room id. */
const roomScopes = new Map<string, ScopeConfig>()
const roomKey = (appId: string, roomId: string) => `${appId}\n${roomId}`
/** Rooms with the same scope share one socket; a route id names the scope by itself. */
const scopeKey = (scope: ScopeConfig) =>
  JSON.stringify(scope.routeId ? [scope.app, scope.kind, 'route', scope.routeId] : [scope.app, scope.kind, scope.capability])

/**
 * Trystero makes one relay for every room joined while any is open, from the
 * first room's config. Each room still needs its own scope, so the relay is a
 * hub that routes each room's topics to its scope's socket.
 */
class ScopeHub {
  private readonly sockets = new Map<string, ScopeSocket>()

  subscribe(room: { appId: string; roomId: string }, topic: string, onMessage: TopicHandler): () => void {
    const joined = roomKey(room.appId, room.roomId)
    const scope = roomScopes.get(joined)
    if (!scope) throw new Error('Durable Objects room has no scope')
    const key = scopeKey(scope)
    let socket = this.sockets.get(key)
    if (!socket) {
      socket = new ScopeSocket(scope)
      this.sockets.set(key, socket)
    }
    const unsubscribe = socket.subscribe(topic, onMessage)
    const owner = socket
    return () => {
      unsubscribe()
      // Trystero lets go of a room's topics only when the room leaves.
      owner.forget(joined)
      if (!owner.idle) return
      owner.close()
      if (this.sockets.get(key) === owner) this.sockets.delete(key)
    }
  }

  publish(room: { appId: string; roomId: string }, topic: string, message: StrategyMessage): void {
    const joined = roomKey(room.appId, room.roomId)
    const scope = roomScopes.get(joined)
    if (scope) this.sockets.get(scopeKey(scope))?.send(joined, topic, message)
  }
}

/** Rooms Trystero has handed out, to tell a new room from one still open. */
const joinedRooms = new WeakSet<object>()

const joinScopedRoom = createTopicStrategy<ScopeHub, DurableObjectsRoomConfig>({
  init: () => new ScopeHub(),
  subscribeTopic: (hub, topic, onMessage, room) => hub.subscribe(room, topic, onMessage),
  publishTopic: (hub, topic, message, room) => hub.publish(room, topic, message),
})

/** Joins a room whose peers find each other through its Durable Object scope. */
export const joinDurableObjectsRoom: JoinRoom<DurableObjectsRoomConfig> = (config, roomId, callbacks) => {
  const key = roomKey(config.appId, roomId)
  const previous = roomScopes.get(key)
  roomScopes.set(key, config.durableObjects)
  const room = joinScopedRoom(config, roomId, callbacks)
  // Trystero hands back a room joined again while still open as it is, still
  // subscribed through its first scope, so that scope stays its own.
  if (!joinedRooms.has(room)) joinedRooms.add(room)
  else if (previous) roomScopes.set(key, previous)
  return room
}

export type { DurableObjectsRoomConfig }
