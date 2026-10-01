/**
 * Peerly's Worker: sign-in, the realtime control plane, workspace channels and
 * ICE servers, in front of the page's static files. Content goes between the
 * members' browsers; the server keeps it only for a premium workspace's
 * history (encrypted, in its channel).
 */
import { handleGoogleSignIn } from '@codefusion-cc/google-sign-in'
import { handleRealtimeRoute, prepareAuthenticatedRealtimeUpgrade, type RealtimeRouteConfig } from '@codefusion-cc/realtime'
import { APP_ID, ROUTES } from '../shared/app.ts'
import { handleSignInCallback } from './signInCallback.ts'
import { handleIceServers } from './ice.ts'
import { signInOptions, signInVerifier, type SignInEnv } from './signInProviders.ts'

export { Channel } from './channel.ts'
export { UserGateway } from './gateway.ts'

const ROUTE_ID = /^[A-Za-z0-9_-]{43}$/

type Env = SignInEnv & Record<string, unknown> & {
  ASSETS: { fetch(request: Request): Promise<Response> }
  CHANNELS: { getByName(name: string): { fetch(request: Request): Promise<Response> } }
  /** The test harness's own origin (http on loopback), matched exactly; unset everywhere deployed. */
  E2E_ALLOWED_ORIGIN?: string
  /** Hostnames of branch previews that sign in through this deployment (`*.preview.peerly.cc`). */
  AUTH_PREVIEW_PARENTS?: string
}

/**
 * Origins whose pages may call this Worker's API: its own, and the test
 * harness's one exact origin. Previews are their own Workers, so each serves
 * its own origin.
 */
function apiOrigin(env: Env, self: string) {
  const extra = typeof env.E2E_ALLOWED_ORIGIN === 'string' ? env.E2E_ALLOWED_ORIGIN.trim() : ''
  return (origin: string) => origin === self || (extra !== '' && origin === extra)
}

/**
 * Origins a sign-in may hand a token back to, besides this Worker's own. Only
 * the stable auth deployment sets `AUTH_PREVIEW_PARENTS` (`preview.peerly.cc`):
 * providers accept no wildcard redirect, so branch previews sign in there.
 */
function signInReturns(env: Env) {
  const parent = typeof env.AUTH_PREVIEW_PARENTS === 'string' ? env.AUTH_PREVIEW_PARENTS.trim().toLowerCase() : ''
  return (origin: string) => {
    try {
      const url = new URL(origin)
      return url.origin === origin && url.protocol === 'https:' && parent !== '' && url.hostname.endsWith(`.${parent}`) &&
        /^[a-z0-9-]+$/.test(url.hostname.slice(0, -parent.length - 1))
    } catch {
      return false
    }
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const config: RealtimeRouteConfig = {
      app: APP_ID,
      allowedOrigin: apiOrigin(env, url.origin),
      requirePublicUserId: true,
      // Workspaces admit people by verified email: every session must carry one.
      requireMemberId: true,
      identityProvider: providerId => signInVerifier(providerId, env),
    }

    if (url.pathname === ROUTES.signInOptions) {
      if (request.method !== 'GET') return json({ code: 'method-not-allowed' }, 405)
      return json({ providers: await signInOptions(env) })
    }
    const returned = await handleSignInCallback(request, signInReturns(env))
    if (returned) return returned
    const google = await handleGoogleSignIn(request, {
      allowedOrigin: signInReturns(env), loginPath: '/signin', context,
      page: { background: { light: '#f7f7fb', dark: '#111318' } },
    })
    if (google) return google

    if (url.pathname.startsWith(ROUTES.workspaces)) {
      const routeId = url.pathname.slice(ROUTES.workspaces.length)
      if (!ROUTE_ID.test(routeId)) return new Response('Not found', { status: 404 })
      const prepared = await prepareAuthenticatedRealtimeUpgrade(request, env as never, config)
      if (prepared.error) return prepared.error
      return env.CHANNELS.getByName(routeId).fetch(prepared.request)
    }
    if (url.pathname === ROUTES.iceServers) return handleIceServers(request, env as never)

    const realtime = await handleRealtimeRoute(request, env as never, config)
    if (realtime) return realtime
    if (url.pathname.startsWith('/api/')) return json({ code: 'not-found' }, 404)
    return env.ASSETS.fetch(request)
  },
}
