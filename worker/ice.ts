/**
 * ICE servers for peer-to-peer links and calls: Cloudflare's STUN for
 * everyone, and short-lived Cloudflare TURN credentials for premium accounts,
 * so their connections get through strict networks too (a relay on one side
 * is enough for a pair).
 */
import { authenticateSessionCookie, gatewayFor, type MembershipView, type RateLimiter } from '@codefusion-cc/realtime'
import { CLOUDFLARE_STUN, generateTurnCredentials, turnConfigured, type TurnEnv } from '@codefusion-cc/realtime-media'
import { APP_ID, PREMIUM } from '../shared/app.ts'

type IceEnv = TurnEnv & {
  NETWORK_SESSION_SECRET?: string
  MEDIA_RATE_LIMITER?: RateLimiter
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })

/** `GET /api/media/ice`: `{ iceServers, ttlMs, relay }` for the signed-in account. */
export async function handleIceServers(request: Request, env: IceEnv): Promise<Response> {
  if (request.method !== 'GET') return json({ code: 'method-not-allowed' }, 405, { allow: 'GET' })
  const auth = await authenticateSessionCookie(request, env as never, { app: APP_ID, requirePublicUserId: true })
  if (!auth) return json({ code: 'auth-required' }, 401)
  const stunOnly = json({ iceServers: [CLOUDFLARE_STUN], ttlMs: 60 * 60_000, relay: false })
  if (!turnConfigured(env)) return stunOnly
  let plan: string | null = null
  try {
    const gateway = gatewayFor(env as never, APP_ID, auth.uid) as unknown as { membership(): Promise<MembershipView> }
    plan = (await gateway.membership()).plan
  } catch {
    // The gateway is busy: a direct path still works for most people.
    return stunOnly
  }
  if (plan !== PREMIUM) return stunOnly
  // Credentials cost a request to Cloudflare: one account asks at most a few times a minute.
  if (env.MEDIA_RATE_LIMITER) {
    const { success } = await env.MEDIA_RATE_LIMITER.limit({ key: `turn:${auth.uid}` })
    if (!success) return json({ code: 'rate-limited' }, 429, { 'retry-after': '60' })
  }
  try {
    const { iceServers, ttlMs } = await generateTurnCredentials(env)
    return json({ iceServers, ttlMs, relay: true })
  } catch {
    return stunOnly
  }
}
