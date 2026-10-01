/**
 * One open workspace: its encrypted channel, the direct links to the members
 * online, and the content both carry.
 *
 * - The channel (a Durable Object only listed members can enter) shows who is
 *   online, passes WebRTC signals, profiles and typing, and with the owner's
 *   premium plan keeps history. Everything on it is encrypted with a key from
 *   the workspace's secret, which the server never has.
 * - Without history, messages and changes go between the members' browsers
 *   over the mesh (`@codefusion-cc/realtime-p2p`), and each pair of devices
 *   brings the other up to date when they meet (`content/sync.ts`).
 * - Every op is signed by its author's device, and counts only once the server
 *   has vouched that the device is the author's: on the channel each event
 *   carries its sender as the server knows it, and a direct link is to a
 *   connection the channel named.
 */
import { openDurableChannel, type ChannelAction, type DurableChannelRoom } from '@codefusion-cc/realtime/browser'
import { CallController } from '@codefusion-cc/realtime-media/browser'
import { cameraConstraints, cameraEncoding, cameraEncodings, DEFAULT_CAMERA_QUALITY } from '@codefusion-cc/realtime-media/policy'
import { createDataMesh, type DataMesh, type MeshPeer } from '@codefusion-cc/realtime-p2p'
import { ROUTES } from '../../shared/app.ts'
import { device, type Account } from '../auth/session.ts'
import { devices } from '../calls/devices.ts'
import { APP_ID } from '../config.ts'
import { deriveChannels, deriveMessages, deriveWorkspaceName, type Channel, type Message } from '../content/derive.ts'
import { newId, parseOp, signedByItsDevice, signOp, type FileRef, type Op, type UnsignedOp } from '../content/ops.ts'
import {
  bindDevice, bindingKey, boundDevices, channelWindow, daySummary, idsOfDay, metaOps, opsById, putOps, WINDOW,
} from '../content/opStore.ts'
import { createSync, parseSyncMessage, type SyncMessage } from '../content/sync.ts'
import type { PreparedFile } from '../files/prepare.ts'
import { WorkspaceFiles } from '../files/workspaceFiles.ts'
import { authorizeWorkspace, isListed, receiveList, setupDone, type Workspace } from './workspaces.ts'

export type Presence = { userId: string; deviceKeyIds: string[] }
export type Profile = { name: string }
export type ChannelState = { messages: Message[]; more: boolean; loading: boolean }

export type SessionView = {
  status: 'connecting' | 'online' | 'reconnecting' | 'refused' | 'closed'
  /** Why the channel would not let this device in. */
  refused: 'not-listed' | 'list-refused' | null
  /** Whether the channel keeps history (the owner's premium plan). */
  history: boolean
  /** Who is online, the signed-in person included. */
  online: Presence[]
  /** Direct links, one per other connection. */
  peers: MeshPeer[]
  channels: Channel[]
  /** The name the owner set in the workspace (falls back to the invite's). */
  name: string
  profiles: Record<string, Profile>
  /** Who is typing in each channel now. */
  typing: Record<string, string[]>
}

type IceAnswer = { iceServers: RTCIceServer[]; ttlMs: number; relay: boolean }
type MeshMessage = SyncMessage | { t: 'op'; op: unknown } | { t: 'list'; list: unknown } | { t: 'names'; names: unknown }

const TYPING_SHOWN_MS = 5_000
const TYPING_SENT_EVERY_MS = 3_000
const NAME_MAX = 80
const NAMES_KEPT = 500

const namesKey = (userId: string, workspaceId: string) => `peerly-names:${userId}:${workspaceId}`

/** The names this device has seen in a workspace, so messages of people offline still say who wrote them. */
function readNames(userId: string, workspaceId: string): Record<string, Profile> {
  try {
    const stored = JSON.parse(localStorage.getItem(namesKey(userId, workspaceId)) ?? '{}') as unknown
    return cleanNames(stored)
  } catch {
    return {}
  }
}

/** Only `{ userId: name }` pairs with a short, non-empty name, at most `NAMES_KEPT` of them. */
function cleanNames(value: unknown): Record<string, Profile> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const names: Record<string, Profile> = {}
  for (const [userId, entry] of Object.entries(value as Record<string, unknown>).slice(0, NAMES_KEPT)) {
    const name = typeof entry === 'string' ? entry : (entry as { name?: unknown } | null)?.name
    if (typeof name === 'string' && name.trim() && userId.length <= 128) names[userId] = { name: name.trim().slice(0, NAME_MAX) }
  }
  return names
}

/** Forgets the names a device kept for a workspace it left. */
export function forgetNames(userId: string, workspaceId: string): void {
  try {
    localStorage.removeItem(namesKey(userId, workspaceId))
  } catch {
    // Nothing kept.
  }
}

const STUN_ONLY: IceAnswer = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }], ttlMs: 60 * 60_000, relay: false }

async function iceServers(): Promise<IceAnswer> {
  try {
    const response = await fetch(ROUTES.iceServers, { credentials: 'same-origin' })
    return response.ok ? await response.json() as IceAnswer : STUN_ONLY
  } catch {
    return STUN_ONLY
  }
}

export class WorkspaceSession {
  readonly account: Account
  workspace: Workspace
  private state: SessionView
  private readonly listeners = new Set<() => void>()
  private room: DurableChannelRoom | null = null
  private mesh: DataMesh | null = null
  private actions: Record<'chat' | 'channel' | 'workspace' | 'roster' | 'profile' | 'typing', ChannelAction<unknown>> | null = null
  private meta: Op[] = []
  private bound = new Set<string>()
  private readonly windows = new Map<string, { ops: Op[]; state: ChannelState }>()
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private lastTypingSent = 0
  private iceTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private readonly sync = createSync({
    summary: () => daySummary(this.account.userId, this.workspace.id),
    idsOfDay: day => idsOfDay(this.account.userId, this.workspace.id, day),
    ops: ids => opsById(this.account.userId, this.workspace.id, ids),
    receive: async (ops, from) => { await this.receive(ops, this.peerIdentity(from)) },
  }, (to, message) => { this.meshSend(message, to) })

  private readonly defaultChannelName: string
  private routeId: string | null = null
  /** The workspace's files on this device (and in the cloud, for a Premium owner's workspace). */
  readonly files: WorkspaceFiles
  /** The workspace's call, which this page is in only after `call.join()`. */
  readonly call: CallController
  private readonly callListeners = new Set<() => void>()

  constructor(account: Account, workspace: Workspace, defaultChannelName = 'general') {
    this.account = account
    this.workspace = workspace
    this.defaultChannelName = defaultChannelName
    this.files = new WorkspaceFiles({
      userId: account.userId, workspaceId: workspace.id, secret: workspace.secret,
      routeId: () => this.routeId, history: () => this.state.history, mesh: () => this.mesh,
    })
    const camera = DEFAULT_CAMERA_QUALITY.standard
    this.call = new CallController({
      userId: account.userId,
      request: (payload, options) => this.room ? this.room.requestServer('media', payload, options) : Promise.reject(new Error('durable-channel-not-open')),
      onChange: () => { for (const listener of this.callListeners) listener() },
      initialDevices: { audioId: devices.loadPreferredAudioInput(), videoId: devices.loadPreferredVideoInput() },
      video: { constraints: () => cameraConstraints(camera), encoding: () => cameraEncoding(camera), encodings: () => cameraEncodings(camera) },
    })
    this.state = {
      status: 'connecting', refused: null, history: false, online: [], peers: [], channels: [], name: workspace.name,
      profiles: { ...readNames(account.userId, workspace.id), [account.userId]: { name: account.name } }, typing: {},
    }
  }

  /**
   * A name for `userId`. What a person says of themselves always counts; a
   * name another member passes on fills in only someone this device has no name for.
   */
  private learnName(userId: string, name: string, firsthand: boolean) {
    const clean = name.trim().slice(0, NAME_MAX)
    const current = this.state.profiles[userId]?.name
    if (!clean || current === clean || (current && !firsthand)) return
    if (!current && Object.keys(this.state.profiles).length >= NAMES_KEPT) return
    this.set({ profiles: { ...this.state.profiles, [userId]: { name: clean } } })
    try {
      localStorage.setItem(namesKey(this.account.userId, this.workspace.id), JSON.stringify(this.state.profiles))
    } catch {
      // Shown for this visit only.
    }
  }

  // ---- what screens read -------------------------------------------------------------------------

  view = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  subscribeCall = (listener: () => void) => { this.callListeners.add(listener); return () => { this.callListeners.delete(listener) } }
  private set(change: Partial<SessionView>) {
    if (this.stopped) return
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }

  channelState(channelId: string): ChannelState {
    return this.windows.get(channelId)?.state ?? { messages: [], more: false, loading: true }
  }

  // ---- lifecycle -----------------------------------------------------------------------------------

  async start(): Promise<void> {
    if (!isListed(this.account, this.workspace.list)) {
      this.set({ status: 'refused', refused: 'not-listed' })
      return
    }
    this.bound = await boundDevices(this.account.userId)
    await this.trust(this.account.userId, await device.publicKeyId())
    this.meta = await metaOps(this.account.userId, this.workspace.id)
    this.refreshMeta()
    try {
      this.room = await openDurableChannel({
        endpointPrefix: ROUTES.workspaces,
        namespace: APP_ID,
        encryptionSecret: this.workspace.secret,
        authorize: async () => {
          const answer = await authorizeWorkspace(this.workspace)
          this.routeId = answer.routeId
          this.set({ history: answer.history })
          return { routeId: answer.routeId }
        },
        onConnectionState: state => {
          this.call.connection(state)
          this.set({ status: state === 'closed' ? 'closed' : state === 'online' ? 'online' : state === 'reconnecting' ? 'reconnecting' : 'connecting' })
        },
        // The call's frames (its state, peers' signals) go to the call.
        onServerFrame: frame => this.call.frame(frame),
        onHistory: enabled => this.set({ history: enabled }),
      })
    } catch {
      if (!this.stopped) this.set({ status: 'refused', refused: 'list-refused' })
      return
    }
    if (this.stopped) { this.room.leave(); return }
    this.bindActions(this.room)
    if (this.workspace.setup) {
      // Its creator's device gives it a first channel and its name, once.
      await this.createChannel(this.defaultChannelName)
      await this.rename(this.workspace.name)
      await setupDone(this.account.userId, this.workspace.id)
      this.workspace = { ...this.workspace, setup: false }
    }
    const ice = await iceServers()
    if (this.stopped) return
    this.mesh = createDataMesh({
      channel: this.room,
      iceServers: ice.iceServers,
      signalEvent: 'p2p',
      onMessage: (message, from) => void this.meshReceived(message as MeshMessage, from),
      onPeers: peers => this.peersChanged(peers),
      // Members online ask each other for files by hash; the mesh checks what comes back.
      provide: hash => this.files.provide(hash),
    })
    this.scheduleIce(ice.ttlMs)
    this.refreshOnline()
    void this.actions?.profile.send({ name: this.account.name }).catch(() => {})
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    clearTimeout(this.iceTimer)
    for (const timer of this.typingTimers.values()) clearTimeout(timer)
    this.mesh?.close()
    this.room?.leave()
    this.files.close()
    this.call.dispose()
    this.callListeners.clear()
    this.listeners.clear()
  }

  private scheduleIce(ttlMs: number) {
    clearTimeout(this.iceTimer)
    // Renewed a minute before it runs out, so TURN credentials never lapse mid-call.
    this.iceTimer = setTimeout(async () => {
      const ice = await iceServers()
      this.mesh?.setIceServers(ice.iceServers)
      this.scheduleIce(ice.ttlMs)
    }, Math.max(30_000, ttlMs - 60_000))
  }

  // ---- the channel ---------------------------------------------------------------------------------

  private bindActions(room: DurableChannelRoom) {
    const chat = room.makeAction<unknown>('chat')
    const channel = room.makeAction<unknown>('channel')
    const workspace = room.makeAction<unknown>('workspace')
    const roster = room.makeAction<unknown>('roster')
    const profile = room.makeAction<unknown>('profile')
    const typing = room.makeAction<unknown>('typing')
    this.actions = { chat, channel, workspace, roster, profile, typing }
    // On the channel the server names each event's sender: that is what vouches for the device.
    const fromChannel = (value: unknown, meta: { userId?: string; deviceKeyId?: string }) => {
      const op = parseOp(value)
      if (op && meta.userId && meta.deviceKeyId) void this.receive([op], { userId: meta.userId, deviceKeyId: meta.deviceKeyId })
    }
    chat.onMessage = fromChannel
    channel.onMessage = fromChannel
    workspace.onMessage = fromChannel
    roster.onMessage = value => { void receiveList(this.account.userId, this.workspace.id, value).then(updated => { if (updated) this.workspace = updated }) }
    profile.onMessage = (value, meta) => {
      const name = (value as { name?: unknown } | null)?.name
      if (meta.userId && typeof name === 'string') this.learnName(meta.userId, name, true)
    }
    typing.onMessage = (value, meta) => {
      const channelId = (value as { c?: unknown })?.c
      if (!meta.userId || meta.userId === this.account.userId || typeof channelId !== 'string') return
      this.showTyping(channelId, meta.userId)
    }
    room.onConnectionJoin = (connectionId, connection) => {
      this.refreshOnline()
      // The newcomer learns this person's name from them, not from anyone else.
      void profile.send({ name: this.account.name }, { to: connectionId }).catch(() => {})
      void this.trust(connection.userId, connection.deviceKeyId)
    }
    room.onConnectionLeave = () => this.refreshOnline()
  }

  private refreshOnline() {
    const byUser = new Map<string, Set<string>>()
    const add = (userId: string, deviceKeyId: string) => byUser.set(userId, (byUser.get(userId) ?? new Set()).add(deviceKeyId))
    for (const connection of Object.values(this.room?.connections() ?? {})) add(connection.userId, connection.deviceKeyId)
    const online = [...byUser].map(([userId, devices]) => ({ userId, deviceKeyIds: [...devices] }))
    if (!online.some(presence => presence.userId === this.account.userId)) online.unshift({ userId: this.account.userId, deviceKeyIds: [] })
    this.set({ online })
  }

  private showTyping(channelId: string, userId: string) {
    const key = `${channelId}\n${userId}`
    clearTimeout(this.typingTimers.get(key))
    const current = this.state.typing[channelId] ?? []
    if (!current.includes(userId)) this.set({ typing: { ...this.state.typing, [channelId]: [...current, userId] } })
    this.typingTimers.set(key, setTimeout(() => {
      this.typingTimers.delete(key)
      this.set({ typing: { ...this.state.typing, [channelId]: (this.state.typing[channelId] ?? []).filter(id => id !== userId) } })
    }, TYPING_SHOWN_MS))
  }

  /** Tells the others this person is typing in a channel (at most every few seconds). */
  typing(channelId: string) {
    const now = Date.now()
    if (now - this.lastTypingSent < TYPING_SENT_EVERY_MS) return
    this.lastTypingSent = now
    void this.actions?.typing.send({ c: channelId }).catch(() => {})
  }

  // ---- the mesh ------------------------------------------------------------------------------------

  private peersChanged(peers: MeshPeer[]) {
    const opened = peers.filter(peer => peer.state === 'open' && !this.state.peers.some(old => old.connectionId === peer.connectionId && old.state === 'open'))
    for (const gone of this.state.peers) if (!peers.some(peer => peer.connectionId === gone.connectionId)) this.sync.close(gone.connectionId)
    this.set({ peers })
    for (const peer of opened) {
      void this.trust(peer.userId, peer.deviceKeyId)
      void this.sync.open(peer.connectionId)
      this.meshSend({ t: 'list', list: this.workspace.list }, peer.connectionId)
      this.meshSend({ t: 'names', names: Object.fromEntries(Object.entries(this.state.profiles).map(([userId, profile]) => [userId, profile.name])) }, peer.connectionId)
    }
  }

  private meshSend(message: MeshMessage, to?: string) {
    try {
      this.mesh?.send(message, to ? { to } : {})
    } catch {
      // Too large for one message: the sync splits ops, so only a broken caller gets here.
    }
  }

  private peerIdentity(connectionId: string) {
    const peer = this.mesh?.peers().find(item => item.connectionId === connectionId)
    return peer ? { userId: peer.userId, deviceKeyId: peer.deviceKeyId, relayed: true } : null
  }

  private async meshReceived(message: MeshMessage, from: MeshPeer) {
    if (message && typeof message === 'object' && 't' in message) {
      if (message.t === 'op') {
        const op = parseOp(message.op)
        if (op) await this.receive([op], { userId: from.userId, deviceKeyId: from.deviceKeyId })
        return
      }
      if (message.t === 'names') {
        for (const [userId, profile] of Object.entries(cleanNames(message.names))) {
          // A peer's own name is firsthand; the rest is what it heard.
          this.learnName(userId, profile.name, userId === from.userId)
        }
        return
      }
      if (message.t === 'list') {
        const updated = await receiveList(this.account.userId, this.workspace.id, message.list)
        if (updated) this.workspace = updated
        return
      }
    }
    const sync = parseSyncMessage(message)
    if (sync) await this.sync.handle(from.connectionId, sync)
  }

  // ---- content -------------------------------------------------------------------------------------

  /** Records that the server vouched for `deviceKeyId` as `userId`'s, and shows what waited on it. */
  private async trust(userId: string, deviceKeyId: string) {
    const key = bindingKey(userId, deviceKeyId)
    if (this.bound.has(key)) return
    this.bound.add(key)
    const promoted = await bindDevice(this.account.userId, userId, deviceKeyId)
    const mine = promoted.filter(item => item.w === this.workspace.id).map(item => item.op)
    if (mine.length) this.applied(mine)
  }

  /**
   * Ops from a peer or the channel. `sender` is who the server says sent them:
   * an op it authored itself counts at once; an op it relays counts once its
   * author's device is vouched for (until then it waits, unseen).
   */
  private async receive(ops: Op[], sender: { userId: string; deviceKeyId: string; relayed?: boolean } | null) {
    if (this.stopped || !ops.length) return
    const checked = (await Promise.all(ops.map(async op => await signedByItsDevice(op) ? op : null))).filter((op): op is Op => op !== null)
    for (const op of checked) {
      if (sender && op.by === sender.userId && op.dk === sender.deviceKeyId) await this.trust(op.by, op.dk)
    }
    const added = await putOps(this.account.userId, this.workspace.id, checked, op => this.bound.has(bindingKey(op.by, op.dk)))
    if (added.length) this.applied(added)
  }

  /** New verified ops: what they change on screen. */
  private applied(ops: Op[]) {
    let metaChanged = false
    for (const op of ops) {
      if (op.kind === 'chan' || op.kind === 'ws') { this.meta.push(op); metaChanged = true; continue }
      const channelId = op.kind === 'msg' ? op.c : [...this.windows].find(([, window]) => window.ops.some(item => item.id === (op as { target: string }).target))?.[0]
      const window = channelId ? this.windows.get(channelId) : undefined
      if (!window) continue
      window.ops.push(op)
      window.state = { ...window.state, messages: deriveMessages(channelId!, window.ops) }
    }
    if (metaChanged) this.refreshMeta()
    else this.set({})
  }

  private refreshMeta() {
    this.set({
      channels: deriveChannels(this.meta),
      name: deriveWorkspaceName(this.meta, this.workspace.list.ownerUserId) ?? this.workspace.name,
    })
  }

  /** Reads a channel's latest messages (once), or older ones. */
  async open(channelId: string, older = false): Promise<void> {
    const current = this.windows.get(channelId)
    if (current && !older) return
    if (current?.state.loading && older) return
    const oldest = older ? current?.state.messages[0]?.at : undefined
    if (current) current.state = { ...current.state, loading: true }
    else this.windows.set(channelId, { ops: [], state: { messages: [], more: false, loading: true } })
    this.set({})
    const { ops, more } = await channelWindow(this.account.userId, this.workspace.id, channelId, oldest ?? Number.MAX_SAFE_INTEGER, WINDOW)
    const window = this.windows.get(channelId)!
    const known = new Set(window.ops.map(op => op.id))
    window.ops = [...ops.filter(op => !known.has(op.id)), ...window.ops]
    window.state = { messages: deriveMessages(channelId, window.ops), more, loading: false }
    this.set({})
  }

  /** Signs an op, keeps it, shows it, and delivers it: through the channel when it keeps history, else to every peer. */
  private async publish(body: UnsignedOp): Promise<Op> {
    const op = await signOp(device, this.account.userId, body)
    await putOps(this.account.userId, this.workspace.id, [op], () => true)
    this.applied([op])
    if (this.state.history && this.actions) {
      const action = op.kind === 'chan' ? this.actions.channel : op.kind === 'ws' ? this.actions.workspace : this.actions.chat
      const state = op.kind === 'chan' ? { key: op.c, revision: op.at } : op.kind === 'ws' ? { key: 'workspace', revision: op.at } : undefined
      // The channel keeps it for whoever is away; its outbox retries until the server has it.
      void action.send(op, { messageId: op.id, ...(state ? { state } : {}) }).catch(() => {})
    } else {
      this.meshSend({ t: 'op', op })
    }
    return op
  }

  send(channelId: string, text: string, files: FileRef[] = [], reply?: string) {
    return this.publish({ kind: 'msg', c: channelId, text, ...(files.length ? { files } : {}), ...(reply ? { reply } : {}) })
  }
  /**
   * Sends a message with files: keeps them here, puts sealed copies in the
   * cloud when the workspace keeps history, then sends the message. Answers
   * how many files the cloud did not keep (members get those from this device).
   */
  async sendWithFiles(channelId: string, text: string, files: PreparedFile[], reply?: string, onProgress?: (fraction: number) => void) {
    const { refs, notKept } = await this.files.prepareToSend(files, onProgress)
    await this.send(channelId, text, refs, reply)
    return { notKept }
  }

  edit(messageId: string, text: string) { return this.publish({ kind: 'edit', target: messageId, text }) }
  remove(messageId: string) { return this.publish({ kind: 'del', target: messageId }) }
  react(messageId: string, emoji: string, on: boolean) { return this.publish({ kind: 'react', target: messageId, emoji, on }) }

  createChannel(name: string) {
    const pos = Math.max(-1, ...this.state.channels.map(channel => channel.pos)) + 1
    return this.publish({ kind: 'chan', c: newId(), name: name.trim(), pos, deleted: false })
  }
  renameChannel(channel: Channel, name: string) { return this.publish({ kind: 'chan', c: channel.id, name: name.trim(), pos: channel.pos, deleted: false }) }
  deleteChannel(channel: Channel) { return this.publish({ kind: 'chan', c: channel.id, name: channel.name, pos: channel.pos, deleted: true }) }
  /** Only the owner's name for the workspace counts; anyone else's is ignored everywhere. */
  rename(name: string) { return this.publish({ kind: 'ws', name: name.trim() }) }

  /** The owner's newer member list, for the members online now (the channel also keeps it with history). */
  shareList() {
    void this.actions?.roster.send(this.workspace.list, { state: { key: 'roster', revision: this.workspace.list.revision } }).catch(() => {})
    this.meshSend({ t: 'list', list: this.workspace.list })
  }
}
