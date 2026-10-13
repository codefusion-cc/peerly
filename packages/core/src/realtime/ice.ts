/**
 * The ICE servers the control session hands this browser: Cloudflare's STUN,
 * and Cloudflare Realtime TURN with short-lived credentials when the
 * deployment has a TURN key. The session refresh renews them well inside
 * their lifetime; a grant that expires anyway (the tab slept, the refresh
 * kept failing) degrades to STUN rather than handing a new peer connection
 * credentials TURN would refuse.
 */

export type IceServer = {
  urls: string[]
  username?: string
  credential?: string
}

export type IceGrant = {
  readonly servers: readonly IceServer[]
  /** When the TURN credentials stop working, in ms since the epoch. Absent for STUN only. */
  readonly expiresAt?: number
}

/** Cloudflare's STUN, used before the session answers and whenever no usable TURN remains. */
export const CLOUDFLARE_STUN_URL = 'stun:stun.cloudflare.com:3478'

/**
 * TURN credentials are treated as spent this long before they expire, so an
 * allocation that starts on them has time to finish.
 */
export const ICE_EXPIRY_MARGIN_MS = 60_000

const MAX_SERVERS = 8
const MAX_URLS = 8
const MAX_SECRET_LENGTH = 2048

// Only Cloudflare's servers, on the ports Cloudflare Realtime publishes: the
// session is the one place ICE servers come from, and nothing else should be
// able to steer a call's media through some other relay.
const ICE_URL = /^(?:stun:stun\.cloudflare\.com:3478|turn:turn\.cloudflare\.com:(?:3478|80)\?transport=(?:udp|tcp)|turns:turn\.cloudflare\.com:(?:5349|443)\?transport=tcp)$/

const isTurnUrl = (url: string) => url.startsWith('turn')
const isSecret = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_SECRET_LENGTH

function parseServer(value: unknown): IceServer | null {
  if (!value || typeof value !== 'object') return null
  const server = value as { urls?: unknown; username?: unknown; credential?: unknown }
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
  if (urls.length === 0 || urls.length > MAX_URLS) return null
  if (!urls.every((url): url is string => typeof url === 'string' && ICE_URL.test(url))) return null
  if (!urls.some(isTurnUrl)) return { urls }
  if (!isSecret(server.username) || !isSecret(server.credential)) return null
  return { urls, username: server.username, credential: server.credential }
}

/**
 * The session's `ice` field, or null when it is missing or malformed. One bad
 * server rejects the whole grant: a list that is half right is a server bug
 * to surface, not something to quietly trim.
 */
export function parseIceGrant(value: unknown, now: number): IceGrant | null {
  if (!value || typeof value !== 'object') return null
  const grant = value as { servers?: unknown; expiresAt?: unknown }
  if (!Array.isArray(grant.servers) || grant.servers.length === 0 || grant.servers.length > MAX_SERVERS) return null
  const servers: IceServer[] = []
  for (const raw of grant.servers) {
    const server = parseServer(raw)
    if (!server) return null
    servers.push(server)
  }
  const relays = servers.some(server => server.urls.some(isTurnUrl))
  if (!relays) return grant.expiresAt === undefined ? { servers } : null
  if (typeof grant.expiresAt !== 'number' || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= now) return null
  return { servers, expiresAt: grant.expiresAt }
}

const STUN_ONLY: readonly IceServer[] = Object.freeze([{ urls: [CLOUDFLARE_STUN_URL] }])

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
      .map(server => ({ urls: server.urls.filter(url => !isTurnUrl(url)) }))
      .filter(server => server.urls.length > 0)
  const usable = servers.length > 0 ? servers : STUN_ONLY
  return usable.map(server => ({ ...server, urls: [...server.urls] }))
}

/** Whether these servers can relay a call, not only discover addresses. */
export function hasTurn(servers: readonly IceServer[] | undefined): boolean {
  return Boolean(servers?.some(server => server.urls.some(isTurnUrl)))
}
