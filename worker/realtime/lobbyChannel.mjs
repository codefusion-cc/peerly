import { defineEphemeralChannel } from '@peerly/core/worker/realtime/ephemeral-channel'

/**
 * Peerly's public authenticated lobby policy.
 *
 * Events are short-lived presence, invitation, and DM-ring control messages.
 * The generic channel never persists them; recipients still verify the
 * product-level device signatures and OIDC attestations.
 */
export const LobbyChannelDO = defineEphemeralChannel({
  allowedEvents: ['pres', 'finv', 'finvr', 'dmring', 'winv'],
})
