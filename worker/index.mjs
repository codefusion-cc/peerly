import { checkMediaHealth, handleMediaHealth, MEDIA_HEALTH_PATH, turnConfigured } from '@codefusion-cc/realtime-media'
import { GOOGLE_KEYS_PATH, handleGoogleSignIn } from '@codefusion-cc/google-sign-in'
import {
  createIdentityRoutes, handleRealtimeRoute, prepareAuthenticatedRealtimeUpgrade, retryOnReset,
} from '@codefusion-cc/realtime'
import { lookupRendezvous } from '../packages/core/worker/rendezvous.mjs'
import { issueLobbyIdentity, verifyLobbyIdentity } from '../packages/core/worker/lobbyIdentity.mjs'
import { identityProvider } from './realtime/identityProvider.mjs'
import { withIceServers } from './realtime/ice.mjs'

export { SignalScopeDO } from '../packages/core/worker/realtime/gateway/signalScope.mjs'
export { UserGatewayDO } from './realtime/gateway.mjs'
export { ContentChannelDO } from './realtime/contentChannel.mjs'
export { LobbyChannelDO } from './realtime/lobbyChannel.mjs'
export { ConsoleAdmin } from './console/consoleAdmin.mjs'

const APP_ID = 'peerly'
const RENDEZVOUS_LOOKUP_PATH = '/api/rendezvous/lookup'
const SESSION_PATH = '/api/network/session'
const CONTENT_CHANNEL_PREFIX = '/api/realtime/content/'
const LOBBY_CHANNEL_PREFIX = '/api/realtime/lobby/'
const SIGNAL_PREFIX = '/api/realtime/signal/'
const LOBBY_ROUTE_ID = 'peerly-lobby-v1'
const ROUTE_ID = /^[A-Za-z0-9_-]{1,128}$/
// Under /api/realtime so the session cookie (Path=/api/realtime) reaches it.
const IDENTITY_ISSUE_PATH = '/api/realtime/identity'
const IDENTITY_VERIFY_PATH = '/api/identity/verify'

export function allowedAuthParent(origin) {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && url.origin === origin && (
      url.hostname === 'peerly.cc' ||
      url.hostname === 'preview.peerly.cc' ||
      /^[a-z0-9-]+\.preview\.peerly\.cc$/i.test(url.hostname) ||
      // `<label>-preview.peerly.cc` alongside `<label>.preview.peerly.cc`;
      // both are staging names on our own zone. See the matching comment in
      // HeyHubs' worker/index.mjs.
      /^[a-z0-9-]+-preview\.peerly\.cc$/i.test(url.hostname) ||
      /^[a-z0-9-]+-peerly\.codefusion\.workers\.dev$/i.test(url.hostname)
    )
  } catch {
    return false
  }
}

/** The page Google sends the browser back to, in Peerly's background (themePreference.ts) so the hop never flashes. */
const googleCallbackPage = {
  background: { light: '#f8f8ff', dark: '#111221' },
  title: 'Signing in to Peerly…',
  failed: 'Sign-in didn’t finish.',
  back: 'Back to sign-in',
}

/**
 * The browser E2E harness runs the worker on localhost over plain http, which
 * `allowedAuthParent` rejects — correctly, for anything deployed.
 *
 * So the harness names its own origin in `E2E_ALLOWED_ORIGIN`, and it is
 * matched as one exact string, never a pattern. A deployment that does not set
 * the variable allows nothing extra, which is why this can be configuration
 * rather than a build-time branch: there is no code path to disable.
 */
function originAllowedBy(env) {
  const extra = typeof env.E2E_ALLOWED_ORIGIN === 'string' ? env.E2E_ALLOWED_ORIGIN.trim() : ''
  return origin => allowedAuthParent(origin) || (extra !== '' && origin === extra)
}

/**
 * Certificates through which peers trust this Worker's word on who an
 * account is, issued to a live session. The session secret signs them under
 * its own MAC domain.
 */
const identityRoutes = createIdentityRoutes({
  app: APP_ID,
  allowedOrigin: (origin, env) => originAllowedBy(env)(origin),
  validateSession: (env, auth, proof) => env.USER_GATEWAYS.getByName(`${APP_ID}:${auth.uid}`)
    .useSessionProof({ ...proof, uid: auth.uid, sid: auth.sid, dk: auth.deviceKeyId }),
  secret: env => env.NETWORK_SESSION_SECRET,
  limiter: env => env.IDENTITY_RATE_LIMITER,
})

/** An authenticated upgrade to the channel object `name` of `namespace`, or the response that refuses it. */
async function upgradeTo(request, env, config, namespace, name) {
  const prepared = await prepareAuthenticatedRealtimeUpgrade(request, env, config)
  if (prepared.error) return prepared.error
  return retryOnReset(() => namespace.getByName(name).fetch(prepared.request))
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url)
    if (url.pathname === MEDIA_HEALTH_PATH) return handleMediaHealth(request, env)
    if (url.pathname === RENDEZVOUS_LOOKUP_PATH) return lookupRendezvous(request, env)
    if (url.pathname === '/api/rendezvous/presence') return issueLobbyIdentity(request, env)
    if (url.pathname === '/api/rendezvous/verify') return verifyLobbyIdentity(request, env)
    if (url.pathname === IDENTITY_ISSUE_PATH) return identityRoutes.issue(request, env)
    if (url.pathname === IDENTITY_VERIFY_PATH) return identityRoutes.verify(request, env)
    const realtimeConfig = {
      app: APP_ID,
      allowedOrigin: originAllowedBy(env),
      requirePublicUserId: true,
      // Preview admits workspace members by verified email: every session there must carry one.
      requireMemberId: env.CONTENT_BACKEND === 'durable-objects',
      identityProvider,
    }
    if (url.pathname.startsWith(LOBBY_CHANNEL_PREFIX)) {
      if (url.pathname.slice(LOBBY_CHANNEL_PREFIX.length) !== LOBBY_ROUTE_ID) {
        return new Response('Not found', { status: 404 })
      }
      return upgradeTo(request, env, realtimeConfig, env.LOBBY_CHANNELS, `${APP_ID}:public-lobby-v1`)
    }
    if (url.pathname.startsWith(CONTENT_CHANNEL_PREFIX)) {
      if (env.CONTENT_BACKEND !== 'durable-objects' || !env.CONTENT_CHANNELS) {
        return Response.json({ code: 'service-unavailable' }, { status: 503 })
      }
      const routeId = url.pathname.slice(CONTENT_CHANNEL_PREFIX.length)
      if (!ROUTE_ID.test(routeId)) return new Response('Not found', { status: 404 })
      return upgradeTo(request, env, realtimeConfig, env.CONTENT_CHANNELS, `${APP_ID}:${routeId}`)
    }
    // Trystero rooms signal through their scope until they move onto channels.
    if (url.pathname.startsWith(SIGNAL_PREFIX)) {
      const routeId = url.pathname.slice(SIGNAL_PREFIX.length)
      if (!ROUTE_ID.test(routeId)) return new Response('Not found', { status: 404 })
      return upgradeTo(request, env, realtimeConfig, env.SIGNAL_SCOPES, `${APP_ID}:${routeId}`)
    }
    const realtimeResponse = await handleRealtimeRoute(request, env, realtimeConfig)
    if (realtimeResponse) {
      // The ICE servers ride the session, so the refresh that renews the cookie renews them too.
      return url.pathname === SESSION_PATH ? withIceServers(realtimeResponse, env) : realtimeResponse
    }
    // Google's redirect comes back through here for this origin and for branch previews and the E2E harness, which
    // sign in through a stable origin (VITE_GOOGLE_CALLBACK_ORIGIN); the token only ever goes to an allowed origin.
    const signIn = await handleGoogleSignIn(request, {
      allowedOrigin: originAllowedBy(env),
      keysPath: GOOGLE_KEYS_PATH,
      page: googleCallbackPage,
      context,
    })
    return signIn ?? env.ASSETS.fetch(request)
  },

  /**
   * Every five minutes (wrangler `triggers`): asks Cloudflare for TURN
   * credentials as a session would, and logs an error line, which the console
   * turns into a failure, when it fails twice or when no TURN key is set.
   */
  async scheduled(_controller, env) {
    if (!turnConfigured(env)) {
      console.error('media health: no TURN key (TURN_KEY_ID, TURN_KEY_API_TOKEN); calls between strict networks cannot connect')
      return
    }
    await checkMediaHealth(env)
  },
}
