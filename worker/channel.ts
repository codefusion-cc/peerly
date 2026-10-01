/**
 * A workspace's channel: only the people its owner listed (by verified email)
 * get in. Every event is encrypted with the workspace's key, which the server
 * never has.
 *
 * - `p2p` carries WebRTC signals to one connection: messages and files then go
 *   between the members' browsers directly.
 * - With the owner's premium plan the channel also keeps history (`chat`, and
 *   the latest `channel` and `workspace` state), so a member who was away gets
 *   it without anyone else online. Without it nothing is stored.
 * - `profile` and `typing` are live only.
 * - With history on, files go to the cloud too (R2, `FILES`), sealed with the
 *   workspace's key; when history ends they are deleted with it.
 * - It hosts the workspace's call (`channelCalls`): peer to peer without
 *   relays for free accounts; a Premium member in it gives the call TURN
 *   relays, and past four people the SFU.
 */
import { defineAuthorizedChannel, gatewayName } from '@codefusion-cc/realtime'
import { channelCalls, type ChannelCalls } from '@codefusion-cc/realtime-media'
import { DEFAULT_CALL_SETTINGS } from '@codefusion-cc/realtime-media/policy'
import { APP_ID, LIMITS, PREMIUM } from '../shared/app.ts'

export const CHANNEL_EVENTS = Object.freeze({
  /** WebRTC signals, to one connection. */
  p2p: 'p2p',
  /** A message, its edit or deletion, or a reaction: signed by its author. */
  chat: 'chat',
  /** A channel's name, order and deletion, by channel id. */
  channel: 'channel',
  /** The workspace's name and icon. */
  workspace: 'workspace',
  /** The owner's newer member list, for members online now. */
  roster: 'roster',
  profile: 'profile',
  typing: 'typing',
})

type Gateways = { getByName(name: string): { membership(): Promise<{ plan: string | null }> } }

/** How calls travel in Peerly: peer to peer; the SFU and relays only for a Premium member's call. */
const CALL_SETTINGS = { ...DEFAULT_CALL_SETTINGS, paid: 'off' as const, meshMax: 4 }

export class Channel extends defineAuthorizedChannel({
  binding: 'CHANNELS',
  allowedEvents: Object.values(CHANNEL_EVENTS),
  persistedEvents: [CHANNEL_EVENTS.chat],
  stateEvents: [CHANNEL_EVENTS.channel, CHANNEL_EVENTS.workspace, CHANNEL_EVENTS.roster],
  maxHistoryEvents: 5_000,
  // 64 KiB: a message with a few image previews, encrypted.
  maxFrameBytes: 64 * 1024,
  maxMembers: 500,
  // Files kept for members who were away, sealed on the page (handleChannelFile serves them).
  cloudFiles: { bucket: 'FILES', maxBytes: LIMITS.cloudBytesPerWorkspace, maxFileBytes: LIMITS.cloudFileBytes },
  extend: host => channelCalls(host, {
    policy: () => ({ settings: CALL_SETTINGS, saving: false }),
    // The member's own plan, from their gateway: a Premium member lets the call use relays and the SFU.
    priority: async (member, env) => (await (env.USER_GATEWAYS as Gateways).getByName(gatewayName(APP_ID, member.uid)).membership()).plan === PREMIUM,
    kind: 'workspace',
  }),
}) {
  /** Whether an SFU slot a member's gateway holds is still in use in this workspace's call. */
  mediaResourceState(input: unknown) {
    return (this.extension as ChannelCalls).resourceState(input)
  }
}
