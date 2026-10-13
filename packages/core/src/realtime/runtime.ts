import { getRuntimeAuthCredential } from '../runtimeCredentials.js'
import { RealtimeClient } from '../app/realtimeClient.js'
import { selectDurableObjectsTransport, type CoordinationTransport } from './transport.js'
import { hasTurn, parseIceGrant, usableIceServers, type IceGrant, type IceServer } from './ice.js'
import { requireAppId, type Env } from '../env.js'
import { resolveSignalingStrategy } from '../signaling.js'

const transports = new Map<string, CoordinationTransport>()
const iceGrants = new Map<string, IceGrant>()
/** Resolves on the first ICE grant per app, so a join that starts while the
 *  control session is still being established still gets TURN instead of
 *  starting on STUN alone. */
const iceArrivals = new Map<string, { promise: Promise<void>; resolve: () => void }>()
const ICE_WAIT_MS = 10_000

function iceArrival(app: string) {
  const existing = iceArrivals.get(app)
  if (existing) return existing
  let resolve = (): void => {}
  const promise = new Promise<void>(settle => { resolve = settle })
  const entry = { promise, resolve }
  iceArrivals.set(app, entry)
  return entry
}

/**
 * One control socket per app/tab. Room joins share it so several active P2P
 * scopes never consume the per-account control-socket allowance.
 */
export function getDurableObjectsTransport(app: string): CoordinationTransport {
  const existing = transports.get(app)
  if (existing) return existing
  const transport = selectDurableObjectsTransport('durable-objects', {
    app,
    credentialProvider: getRuntimeAuthCredential,
  })
  if (!transport) throw new Error('Durable Objects transport is unavailable')
  transport.events.addEventListener('ice', event => {
    // A session that was still being established when its socket closed (a
    // sign-out, an account switch) must not hand its servers to the next one.
    if (transports.get(app) !== transport) return
    const grant = parseIceGrant((event as CustomEvent<unknown>).detail, Date.now())
    if (!grant) {
      // Keep the last good grant: it is still the best this tab has, and it
      // degrades to STUN by itself when it expires.
      console.warn('[peerly] the session sent no usable ICE servers')
      return
    }
    iceGrants.set(app, grant)
    iceArrival(app).resolve()
  })
  transports.set(app, transport)
  return transport
}

/**
 * Establishes the shared authenticated control session before an app opens
 * any direct Durable Object channel that relies on its HttpOnly session
 * cookie. This keeps session bootstrapping inside the realtime boundary
 * instead of making product hooks send a fake command as a side effect.
 */
export async function ensureDurableObjectsSession(app: string): Promise<void> {
  await getDurableObjectsTransport(app).connect()
}

/** Sends one app-owned command over the shared authenticated control socket. */
export async function sendRealtimeCommand<T = unknown>(
  app: string,
  type: string,
  payload?: unknown
): Promise<T> {
  const transport = getDurableObjectsTransport(app)
  await transport.connect()
  return transport.sendCommand<T>(type, payload)
}

/**
 * The ICE servers for a peer connection made now. Read it at each connection,
 * not once per room: the session refresh replaces the TURN credentials while
 * a room stays open.
 */
export function currentIceServers(app: string, now = Date.now()): IceServer[] {
  return usableIceServers(iceGrants.get(app), now)
}

/** Whether a peer connection made now could relay through TURN. */
export function durableObjectsTurnAvailable(app: string, now = Date.now()): boolean {
  return hasTurn(currentIceServers(app, now))
}

/**
 * The ICE servers once the control session has answered, or undefined when
 * it has not within a bounded wait.
 */
export async function getDurableObjectsIceServers(app: string): Promise<IceServer[] | undefined> {
  await awaitDurableObjectsIce(app)
  return iceGrants.has(app) ? currentIceServers(app) : undefined
}

/**
 * Waits for the control session's first ICE grant, a bounded moment at most,
 * so the first peer connections of a fresh tab can use TURN.
 */
export async function awaitDurableObjectsIce(app: string): Promise<void> {
  const transport = getDurableObjectsTransport(app)
  const arrival = iceArrival(app)
  // `connect()` resolves even when the cycle failed and only scheduled a
  // retry, so the grant may not have landed yet; once one has, `arrival` is
  // settled and the race below returns at once.
  await transport.connect()
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    arrival.promise,
    new Promise<void>(resolve => { timer = setTimeout(resolve, ICE_WAIT_MS) }),
  ])
  clearTimeout(timer)
}

/**
 * Revoke one of this account's own devices on the control plane: its server
 * sessions are deleted, its device epoch is bumped so any capability it still
 * holds stops validating, and its control sockets are closed.
 *
 * A no-op on the development-only nostr and Supabase signaling, which have no
 * server-side device registry, so callers can wire this to "revoke"
 * unconditionally. Rejects if the control plane could not be reached, because
 * a revocation that silently did nothing is worse than one that reports
 * failure.
 */
export async function revokeRealtimeDevice(env: Env, deviceKeyId: string): Promise<void> {
  if (resolveSignalingStrategy(env) !== 'durable-objects') return
  await getDurableObjectsTransport(requireAppId(env)).revokeDevice(deviceKeyId)
}

export function closeDurableObjectsTransport(app?: string): void {
  if (app) {
    transports.get(app)?.close()
    transports.delete(app)
    iceGrants.delete(app)
    iceArrivals.delete(app)
    return
  }
  for (const transport of transports.values()) transport.close()
  transports.clear()
  iceGrants.clear()
  iceArrivals.clear()
}

export { RealtimeClient }
