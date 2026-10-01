/** Peerly's app id: it names every gateway, key and route the realtime packages derive. Never change it. */
export const APP_ID = 'peerly'

/** The plan staff grant from CodeFusion Console: history, cloud files and relays (`docs/PREMIUM.md`). */
export const PREMIUM = 'premium'
export const PLANS = [PREMIUM] as const

/** Where the page reaches the Worker. */
export const ROUTES = Object.freeze({
  /** The sign-in providers this deployment offers. */
  signInOptions: '/api/auth/providers',
  /** Microsoft, Apple and OpenID Connect return here by form post: `/api/auth/<provider>/callback`. */
  signInCallback: (provider: 'microsoft' | 'apple' | 'oidc') => `/api/auth/${provider}/callback`,
  /** A workspace's channel, by its route id: `/api/workspaces/<routeId>`. */
  workspaces: '/api/workspaces/',
  /** A direct conversation's channel: `/api/dms/<routeId>`. */
  dms: '/api/dms/',
  /** STUN, and TURN for premium accounts. */
  iceServers: '/api/media/ice',
  /** Premium cloud files: `/api/files/<workspaceRouteId>/<sha256>`. */
  files: '/api/files/',
})

/** Bounds both sides enforce. */
export const LIMITS = Object.freeze({
  /** People a workspace lists. */
  workspaceMembers: 500,
  workspaceName: 120,
  channelName: 80,
  /** A message's text, in characters. */
  messageText: 8_000,
  /** One file shared peer to peer or to the cloud. */
  fileBytes: 100 * 1024 * 1024,
  /** What one premium account may keep in cloud files, across workspaces. */
  cloudBytesPerAccount: 10 * 1024 * 1024 * 1024,
  /** Files one account may upload a minute. */
  uploadsPerMinute: 30,
})
