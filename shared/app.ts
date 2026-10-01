/** Peerly's app id: it names every gateway, key and route the realtime packages derive. Never change it. */
export const APP_ID = 'peerly'

/** The plan staff grant from CodeFusion Console: history, cloud files and relays (`docs/PREMIUM.md`). */
export const PREMIUM = 'premium'
export const PLANS = [PREMIUM] as const

/**
 * Where the page reaches the Worker. Every route a signed-in browser calls
 * with its session sits under `/api/realtime/`: the session cookie is scoped
 * to that path, so a browser sends it nowhere else.
 */
export const ROUTES = Object.freeze({
  /** The sign-in providers this deployment offers. */
  signInOptions: '/api/auth/providers',
  /** Microsoft, Apple and OpenID Connect return here by form post: `/api/auth/<provider>/callback`. */
  signInCallback: (provider: 'microsoft' | 'apple' | 'oidc') => `/api/auth/${provider}/callback`,
  /** A workspace's channel, by its route id: `/api/realtime/workspaces/<routeId>`. */
  workspaces: '/api/realtime/workspaces/',
  /** A direct conversation's channel: `/api/realtime/dms/<routeId>`. */
  dms: '/api/realtime/dms/',
  /** STUN, and TURN for premium accounts. */
  iceServers: '/api/realtime/media/ice',
  /** Premium cloud files: `/api/realtime/files/<workspaceRouteId>/<sha256>`. */
  files: '/api/realtime/files/',
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
  /** A file as the cloud keeps it: sealed, with its IV and tag (SEALED_FILE_OVERHEAD). */
  cloudFileBytes: 100 * 1024 * 1024 + 28,
  /** What a premium owner's workspace may keep in cloud files. */
  cloudBytesPerWorkspace: 5 * 1024 * 1024 * 1024,
  /** Files attached to one message. */
  filesPerMessage: 10,
})
