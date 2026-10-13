/**
 * The ICE servers the control session hands this browser: Cloudflare's STUN,
 * and Cloudflare Realtime TURN with short-lived credentials when the
 * deployment has a TURN key. The session refresh renews them well inside
 * their lifetime; a grant that expires anyway (the tab slept, the refresh
 * kept failing) degrades to STUN rather than handing a new peer connection
 * credentials TURN would refuse.
 */
import {
  CLOUDFLARE_STUN, hasRelay, isRelayUrl, parseIceServers, type IceServer,
} from '@codefusion-cc/realtime-media/ice'

export type IceGrant = {
  readonly servers: readonly IceServer[]
  /** When the TURN credentials stop working, in ms since the epoch. Absent for STUN only. */
  readonly expiresAt?: number
}

/**
 * TURN credentials are treated as spent this long before they expire, so an
 * allocation that starts on them has time to finish.
 */
export const ICE_EXPIRY_MARGIN_MS = 60_000

/** Cloudflare issues TURN credentials for at most a day. */
const MAX_TTL_MS = 86_400_000

/**
 * The session's `ice` field, received at `now`, or null when it is missing or
 * malformed. One bad server rejects the whole grant: a list that is half right
 * is a server bug to surface, not something to quietly trim.
 *
 * The session says how long TURN works (`ttlMs`), not until when, so the
 * expiry is measured on this device's clock: a clock an hour off would
 * otherwise reject every grant, or keep handing out spent credentials.
 */
export function parseIceGrant(value: unknown, now: number): IceGrant | null {
  if (!value || typeof value !== 'object') return null
  const grant = value as { servers?: unknown; ttlMs?: unknown }
  // Only Cloudflare's servers, on the ports Cloudflare Realtime publishes: the
  // session is the one place ICE servers come from, and nothing else should
  // be able to steer a call's media through some other relay.
  const servers = parseIceServers(grant.servers)
  if (!servers) return null
  if (!hasRelay(servers)) return grant.ttlMs === undefined ? { servers } : null
  if (typeof grant.ttlMs !== 'number' || !(grant.ttlMs > 0 && grant.ttlMs <= MAX_TTL_MS)) return null
  return { servers, expiresAt: now + grant.ttlMs }
}

const STUN_ONLY: readonly IceServer[] = Object.freeze([CLOUDFLARE_STUN])

/**
 * What a peer connection made at `now` should use: the grant's servers while
 * its TURN credentials are fresh, its STUN alone once they are not, and
 * Cloudflare's STUN when there is no grant yet.
 */
export function usableIceServers(grant: IceGrant | undefined, now: number): IceServer[] {
  if (!grant) return STUN_ONLY.map(server => ({ urls: [...server.urls] }))
  const fresh = grant.expiresAt === undefined || now < grant.expiresAt - ICE_EXPIRY_MARGIN_MS
  const servers = fresh
    ? grant.servers
    : grant.servers
      .map(server => ({ urls: server.urls.filter(url => !isRelayUrl(url)) }))
      .filter(server => server.urls.length > 0)
  const usable = servers.length > 0 ? servers : STUN_ONLY
  return usable.map(server => ({ ...server, urls: [...server.urls] }))
}
