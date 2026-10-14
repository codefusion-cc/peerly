import type { Env } from './env.js'

export type SignalingStrategy = 'durable-objects' | 'nostr' | 'supabase'

/**
 * Durable Objects unless the build names another strategy. Deployments signal
 * through the app's own Worker; `nostr` and `supabase` exist for a dev server
 * with no Worker behind it, and only when asked for by name, so a build that
 * forgot its configuration still talks to its own Worker rather than to
 * public relays.
 */
export function resolveSignalingStrategy(env: Env): SignalingStrategy {
  const mode = env.VITE_SIGNALING
  if (mode === 'nostr') return 'nostr'
  if (mode === 'supabase') return 'supabase'
  return 'durable-objects'
}

export function signalingLabel(strategy: SignalingStrategy): string {
  if (strategy === 'durable-objects') return 'Cloudflare'
  if (strategy === 'supabase') return 'Supabase'
  return 'Nostr'
}
