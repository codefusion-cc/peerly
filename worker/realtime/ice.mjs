import { CLOUDFLARE_STUN, generateTurnCredentials, turnConfigured } from '@codefusion-cc/realtime-media'

/**
 * How long a session waits for Cloudflare's TURN credentials before it answers
 * with STUN alone. The session is what opens signaling, so a slow TURN API
 * must not hold it up; the next refresh (`sessionRefreshMs`) asks again.
 */
export const TURN_WAIT_MS = 3_000

/**
 * The ICE servers a browser's session gets: Cloudflare's STUN, plus
 * short-lived Cloudflare Realtime TURN credentials when the deployment has a
 * TURN key (`TURN_KEY_ID`, `TURN_KEY_API_TOKEN`).
 *
 * Without a key, or when Cloudflare does not answer in time, the answer is
 * STUN alone: calls still connect between most networks, and only peers behind
 * strict NAT or firewalls cannot reach each other. Never throws; a failure is
 * an error line, which the console turns into a failure, and the media health
 * check (`/api/media/health`, the cron) says the same.
 *
 * `expiresAt` is when the TURN credentials stop working; STUN alone has none.
 */
export async function issueIceServers(env, { now = Date.now(), fetcher = fetch, waitMs = TURN_WAIT_MS } = {}) {
  const stunOnly = { servers: [CLOUDFLARE_STUN] }
  if (!turnConfigured(env)) return stunOnly
  let timer
  const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), waitMs) })
  try {
    const turn = await Promise.race([generateTurnCredentials(env, fetcher), late])
    if (!turn) {
      console.error(`turn: Cloudflare gave no TURN credentials within ${waitMs} ms; the session got STUN only`)
      return stunOnly
    }
    return { servers: turn.iceServers, expiresAt: now + turn.ttlMs }
  } catch (error) {
    console.error(`turn: ${error instanceof Error ? error.message : 'failed'}; the session got STUN only`)
    return stunOnly
  } finally {
    clearTimeout(timer)
  }
}
