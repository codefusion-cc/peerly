import {
  getNostrRelayConfig as coreNostrConfig,
  getSupabaseRoomConfig as coreSupabaseConfig,
  requireAppId,
  type Env,
} from '@peerly/core'

export const APP_NAME = 'Peerly'

/**
 * Prefix for this app's browser-local storage: IndexedDB databases,
 * localStorage keys and DOM event names. Shared factories in @peerly/core take
 * it as a parameter so two products in one browser never collide.
 */
export const APP_STORAGE_SCOPE = 'peerly'

/**
 * Build identity, injected by vite.config.ts. Version alone does not move on
 * every push, so the commit is what actually answers "is the deployed app
 * running my latest code?".
 */
export const APP_VERSION = __APP_VERSION__
export const APP_COMMIT = __APP_COMMIT__

/** e.g. "v0.2.0 · a1b2c3d" — falls back gracefully when the commit is unknown. */
export function appBuildLabel(): string {
  return APP_COMMIT && APP_COMMIT !== 'unknown'
    ? `v${APP_VERSION} · ${APP_COMMIT}`
    : `v${APP_VERSION}`
}

export const APP_ID = 'peerly-collab-v1'

/** Explicit public allowlist: never embed the complete hosting environment. */
export const PUBLIC_NETWORK_ENV: Env = {
  VITE_APP_ID: import.meta.env.VITE_APP_ID,
  VITE_SIGNALING: import.meta.env.VITE_SIGNALING,
  VITE_NOSTR_RELAYS: import.meta.env.VITE_NOSTR_RELAYS,
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
}
export const NETWORK_APP_ID = requireAppId(PUBLIC_NETWORK_ENV)

export type ContentBackend = 'durable-objects' | 'p2p'

/** Production keeps messages and files peer to peer; the preview build keeps them on the server. */
export function resolveContentBackend(
  value: string | undefined = import.meta.env.VITE_CONTENT_BACKEND
): ContentBackend {
  return value === 'durable-objects' ? 'durable-objects' : 'p2p'
}

export const CONTENT_BACKEND = resolveContentBackend()

export const DEFAULT_USER_COLOR = '#36c5f0'

export { GENERAL_CHANNEL } from './collab/channelStore'

/** Fallback tile colour for workspace avatars (brand emerald). */
export const WORKSPACE_COLOR = '#2eb67d'

// Peer colors moved to @peerly/core (identicon.ts) so every app renders the
// same peer identically; re-exported here so existing imports keep working.
export { getPeerColor, PEER_COLORS } from '@peerly/core'

export function normalizeWorkspaceId(workspace: string): string {
  return workspace.trim().toLowerCase().replace(/\s+/g, '-')
}

/** One P2P room per workspace; messages are scoped by channelId. */
export function buildRoomId(workspaceId: string): string {
  return workspaceId.trim()
}

import type { SignalingStrategy } from './collab/signaling'

// The Nostr and Supabase dev signaling config lives in @peerly/core
// (packages/core/src/relays.ts); these wrappers bind it to this app's
// build-time env. `pnpm run check:relays` reads the list out of the package
// source.
export { DEFAULT_NOSTR_RELAYS } from '@peerly/core'

/** Nostr relay URLs (wss://…). Override via VITE_NOSTR_RELAYS comma-separated env. */
export function getNostrRelayConfig(): { urls: string[] } {
  return coreNostrConfig(PUBLIC_NETWORK_ENV)
}

export function getSupabaseRoomConfig():
  | { appId: string; relayConfig: { supabaseKey: string } }
  | null {
  return coreSupabaseConfig(PUBLIC_NETWORK_ENV)
}

export function getRoomAppId(strategy: SignalingStrategy): string {
  if (strategy === 'supabase') {
    return getSupabaseRoomConfig()?.appId ?? APP_ID
  }
  return APP_ID
}
