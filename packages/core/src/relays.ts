import type { Env } from './env.js'

/**
 * Curated public Nostr relays used for signaling.
 *
 * Trystero ships ~47 default relays and normally connects to just 5 of them
 * (chosen deterministically from the app id). Passing its full list through
 * `relayConfig.urls` — as Peerly used to — defeats that and opens a socket to
 * every relay: measured at 26+ live sockets per peer, for no benefit. Peers only
 * need one working relay in common to exchange offers.
 *
 * Each of these was verified to accept and forward the ephemeral events
 * (kind 2xxxx) Trystero signals with; several popular relays silently don't.
 * Public relays come and go — override with VITE_NOSTR_RELAYS if these rot.
 */
export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.primal.net',
  'wss://purplerelay.com',
  'wss://relay.snort.social',
  'wss://nostr.sathoarder.com',
  'wss://soloco.nl',
]
// Relays deliberately absent, for different reasons:
//
// - nos.lol and relay.wellorder.net rotted in place (2026-07-17, second
//   sweep): wellorder now answers every publish "blocked: spam not
//   permitted"; nos.lol still passes one-shot probes but demands 28-bit
//   proof-of-work once a chatty lobby publishes at a steady rate — the
//   conditional-throttle class that a single probe cannot catch (see damus
//   below). Replacements nostr.sathoarder.com and soloco.nl probed 3x at
//   ~1.1s each.
// - nostr.mom and offchain.pub were in this list and rotted in place
//   (2026-07-17): both keep the socket open, so they look connected, then
//   reject every publish — mom now demands 28-bit proof-of-work, offchain
//   gates on a web-of-trust. That failure mode is invisible to a socket
//   count; only the echo probe (check:relays / probeNostrRelays) catches it.
// - relay.damus.io and nostr.oxtr.dev accept one-off ephemeral events (they
//   pass check:relays) but rate-limit this traffic pattern in normal use —
//   oxtr throttled a single quiet client. A relay like that logs failures
//   without carrying signaling, and every connected relay receives every
//   publish, so keep the pool at five vetted hosts rather than growing it:
//   more relays means more fan-out, which is what trips the limits.
// - relay.snort.social was skipped in 2026-07-16 probing as slow and
//   throttle-prone; re-probed 3x on 2026-07-17 at a consistent ~1.1s and
//   promoted. relay.wellorder.net likewise passed 3x (~1.9s). Candidates
//   gated by NIP-05 (einundzwanzig, nostrplebs) or erroring (bitcoiner,
//   nostr.band) stay out.
// - relay.mostr.pub stopped accepting connections entirely (it was in this list
//   and produced a stream of "WebSocket connection failed" in the console).
//
// Losing one relay is harmless — peers only need one working relay in common —
// but a dead entry is pure console noise, so keep this list to relays actually
// verified against the ephemeral events Trystero signals with. Peerly's
// `npm run check:relays` re-checks the list; a one-shot probe is not enough
// evidence, since that is exactly how mostr.pub got in here.

/** Nostr relay URLs (wss://…). Override via VITE_NOSTR_RELAYS comma-separated env. */
export function getNostrRelayConfig(env: Env): { urls: string[] } {
  const raw = env.VITE_NOSTR_RELAYS
  if (raw) {
    const urls = raw
      .split(',')
      .map(url => url.trim())
      .filter(Boolean)
    if (urls.length > 0) return { urls }
  }
  return { urls: DEFAULT_NOSTR_RELAYS }
}

export function getSupabaseRoomConfig(env: Env):
  | { appId: string; relayConfig: { supabaseKey: string } }
  | null {
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return { appId: url, relayConfig: { supabaseKey: key } }
}
