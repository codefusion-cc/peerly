import { deriveScopeRouteId } from '@codefusion-cc/realtime'
import { boundedString, defineCommand, FrameError, isPlainObject } from '@codefusion-cc/realtime/protocol'
import { SCOPE_KINDS } from '@peerly/core/realtime/protocol'

/**
 * `scope.request`: a lease on one `SignalScopeDO`, through which Trystero
 * rooms signal. Kept from Peerly's own control plane until the rooms move
 * onto channels, then deleted with `SignalScopeDO` (its `deleted_classes`
 * migration ships in the same deploy).
 */

/** How long a lease lasts; the page asks again on every join. */
const SCOPE_LEASE_MS = 10 * 60_000

export const SIGNAL_SCOPE_COMMANDS = [
  defineCommand('scope.request', payload => {
    if (!isPlainObject(payload) || !SCOPE_KINDS.includes(payload.kind) || !boundedString(payload.capability, 256)) {
      throw new FrameError('malformed payload for scope.request')
    }
    return { kind: payload.kind, capability: payload.capability }
  }),
]

/** The signal scopes' part of the account gateway, for `combineGatewayApps`. */
export function signalScopeGateway() {
  return {
    commands: SIGNAL_SCOPE_COMMANDS,
    handlers: ({ env, appName, clock }) => ({
      'scope.request': async (payload, context) => {
        if (!env.SIGNAL_SCOPES) throw new FrameError('signalling is not available', { code: 'not-found' })
        // The secret that never rotates: a rotated session secret must not move every room to a new scope.
        const routeId = await deriveScopeRouteId(env.OPAQUE_USER_ID_SECRET, appName, payload.kind, payload.capability)
        const expiresAt = clock.nowMs() + SCOPE_LEASE_MS
        await env.SIGNAL_SCOPES.getByName(`${appName}:${routeId}`)
          .authorize({ uid: context.identity, dk: context.deviceKeyId, expiresAt })
        return { routeId, expiresAt }
      },
    }),
  }
}
