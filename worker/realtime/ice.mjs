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
 * `ttlMs` is how long the TURN credentials work from now; STUN alone has
 * none. A lifetime rather than a moment, so the browser measures it on its own
 * clock, however far that is from the Worker's.
 */
export async function issueIceServers(env, { fetcher = fetch, waitMs = TURN_WAIT_MS } = {}) {
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
    return { servers: turn.iceServers, ttlMs: turn.ttlMs }
  } catch (error) {
    console.error(`turn: ${error instanceof Error ? error.message : 'failed'}; the session got STUN only`)
    return stunOnly
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The session route's answer with the ICE servers added (`ice`), as the page
 * reads them. A refused session gets none and is passed on untouched.
 */
export async function withIceServers(response, env) {
  if (response.status !== 200) return response
  const body = await response.json()
  return Response.json({ ...body, ice: await issueIceServers(env) }, { headers: response.headers })
}
