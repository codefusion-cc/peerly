/**
 * Peerly's account gateway: realtime's, with linked devices, the account's
 * plan (premium, granted from CodeFusion Console), the budget calls spend
 * from, and entering workspaces.
 */
import { accountDevicesGateway, combineGatewayApps, defineUserGateway, membershipGateway, readMembership } from '@codefusion-cc/realtime'
import { mediaGateway } from '@codefusion-cc/realtime-media'
import { APP_ID, PLANS } from '../shared/app.ts'
import { workspaceGateway } from './workspaces.ts'

/** The binding of the channels workspaces (and their calls) live in. */
export const CHANNEL_BINDING = 'CHANNELS'

export const UserGateway = defineUserGateway(combineGatewayApps(
  workspaceGateway(env => (env[CHANNEL_BINDING] as never) ?? null),
  accountDevicesGateway({ scheme: APP_ID }),
  membershipGateway({ plans: PLANS }),
  mediaGateway({
    rooms: CHANNEL_BINDING,
    // A call's statistics say whether the connection was a premium account's.
    admitted: sql => ({ tier: readMembership(sql).plan ?? 'free' }),
  }),
))
