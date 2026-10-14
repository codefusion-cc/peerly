import type { getRelaySockets } from '@trystero-p2p/nostr'
import { isRealtimeTransportOnline } from './realtime/liveness.js'
import type { SignalingStrategy } from './signaling.js'

type SocketMap = ReturnType<typeof getRelaySockets>

export type RelayHealth = {
  getConnectedRelayUrls(): string[]
  isRelayOnline(): boolean
}

/**
 * Relay-socket visibility for one signaling strategy. A factory rather than
 * module-level state because the strategy is the app's build-time choice and a
 * library cannot read the app's env at import time.
 */
export function createRelayHealth(strategy: SignalingStrategy): RelayHealth {
  // Loaded only on the Nostr dev strategy, so a deployment's bundle does not
  // carry the Nostr client.
  let nostrSockets: (() => SocketMap) | null = null
  if (strategy === 'nostr') {
    void import('@trystero-p2p/nostr').then(module => {
      nostrSockets = module.getRelaySockets
    })
  }

  function getConnectedRelayUrls(): string[] {
    if (strategy === 'supabase') {
      return ['supabase-realtime']
    }
    // One control socket, not a set of relays. Naming it keeps the endpoint
    // count in the UI honest rather than showing zero.
    if (strategy === 'durable-objects') {
      return isRealtimeTransportOnline() ? ['durable-objects-control'] : []
    }

    return Object.entries(nostrSockets?.() ?? {})
      .filter(([, socket]) => (socket as WebSocket).readyState === WebSocket.OPEN)
      .map(([url]) => url)
  }

  function isRelayOnline(): boolean {
    if (strategy === 'supabase') return true
    // Without this case the poll asked the Nostr socket map, which is empty on
    // this strategy, and the app reported "Signaling offline" throughout a
    // working session.
    if (strategy === 'durable-objects') return isRealtimeTransportOnline()
    return getConnectedRelayUrls().length > 0
  }

  return { getConnectedRelayUrls, isRelayOnline }
}
