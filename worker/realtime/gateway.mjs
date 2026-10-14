import { combineGatewayApps, defineUserGateway } from '@codefusion-cc/realtime'
import { CONTENT_COMMANDS, createContentHandlers } from './commands/content.mjs'
import { deviceRevocationGateway } from './commands/devices.mjs'
import { signalScopeGateway } from './commands/signalScopes.mjs'

/**
 * Each device's member id, the HMAC of the verified email its sign-in named.
 * The Worker stamps it on the control upgrade from the signed cookie
 * (`x-realtime-member`); content authorization needs it, and the package's
 * command context carries only the account and device.
 */
const MEMBER_SCHEMA = 'CREATE TABLE IF NOT EXISTS device_members (dk TEXT PRIMARY KEY, member_id TEXT NOT NULL)'

function rememberMemberId(sql, dk, memberId) {
  if (memberId) sql.exec('INSERT OR REPLACE INTO device_members (dk, member_id) VALUES (?, ?)', dk, memberId)
  else sql.exec('DELETE FROM device_members WHERE dk = ?', dk)
  // Bounded by the account's sessions: a device signed out or evicted leaves no row behind.
  sql.exec('DELETE FROM device_members WHERE dk NOT IN (SELECT dk FROM sessions)')
}

const memberIdOf = (sql, dk) =>
  sql.exec('SELECT member_id FROM device_members WHERE dk = ?', dk).toArray()[0]?.member_id

/** Preview's encrypted content channels: workspace and DM authorization, with the caller's member id. */
const contentGateway = {
  schema: MEMBER_SCHEMA,
  channelBindings: ['CONTENT_CHANNELS'],
  onDeviceSignedOut: (sql, dk) => sql.exec('DELETE FROM device_members WHERE dk = ?', dk),
  handlers: ({ sql, clock, appName, env }) => {
    const handlers = createContentHandlers({
      clock,
      appName,
      opaqueUserIdSecret: env.OPAQUE_USER_ID_SECRET,
      channels: env.CONTENT_CHANNELS ?? null,
    })
    return Object.fromEntries(Object.entries(handlers).map(([type, handle]) => [type,
      (payload, context) => handle(payload, { ...context, privateMemberId: memberIdOf(sql, context.deviceKeyId) })]))
  },
  commands: CONTENT_COMMANDS,
}

const UserGateway = defineUserGateway(combineGatewayApps(
  contentGateway,
  deviceRevocationGateway(),
  signalScopeGateway(),
))

/** Peerly's account gateway: the package's, with Peerly's commands. The class name is the deployed one. */
export class UserGatewayDO extends UserGateway {
  async fetch(request) {
    const response = await super.fetch(request)
    if (response.status === 101) {
      rememberMemberId(this.ctx.storage.sql, request.headers.get('x-realtime-dk'), request.headers.get('x-realtime-member'))
    }
    return response
  }
}
