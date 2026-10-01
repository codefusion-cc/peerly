/**
 * Entering a workspace: the account gateway checks the owner's signed member
 * list and installs it in the workspace's channel, which then admits only the
 * member ids (verified emails) the list names. The page connects to the route
 * id this answers; the workspace's secret never reaches the server, only a
 * capability derived from it, and the route is an HMAC of that.
 *
 * Whether the channel keeps history follows the owner's plan: only the owner's
 * own sessions decide it (premium: on until the plan ends; otherwise off), and
 * every other member's presentation of the list leaves it as it is.
 */
import { createAccountKeys } from '@codefusion-cc/realtime/browser'
import { accountKeyIdOf, deriveMemberId, deriveScopeRouteId, readMembership, sha256Hex, type UserGatewayApp } from '@codefusion-cc/realtime'
import { defineCommand, FrameError, isPlainObject } from '@codefusion-cc/realtime/protocol'
import { APP_ID, PREMIUM } from '../shared/app.ts'
import { memberListBytes, parseMemberList, verifyMemberList, type MemberList } from '../shared/memberList.ts'

const keys = createAccountKeys(APP_ID)
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/
/** How long a channel's grant lasts before the page asks again (it does on every connection). */
const AUTHORIZED_MS = 5 * 60_000

/** The channel RPC this needs (a `defineAuthorizedChannel` stub). */
type ChannelStub = { authorize(authority: Record<string, unknown>): Promise<{ ok?: boolean; code?: string; history?: boolean }> }
type ChannelNamespace = { getByName(name: string): ChannelStub }

/** `workspace.authorize`: a capability and the owner's signed list. */
export const WORKSPACE_COMMANDS = [
  defineCommand('workspace.authorize', payload => {
    if (!isPlainObject(payload) || typeof payload.capability !== 'string' || !CAPABILITY.test(payload.capability)) {
      throw new FrameError('malformed payload for workspace.authorize')
    }
    const list = parseMemberList(payload.list)
    if (!list || list.scope !== payload.capability) throw new FrameError('malformed payload for workspace.authorize')
    return { capability: payload.capability, list }
  }),
]

/** The workspace commands' part of the account gateway (`combineGatewayApps`). */
export function workspaceGateway(channels: (env: Record<string, unknown>) => ChannelNamespace | null): UserGatewayApp {
  return {
    commands: WORKSPACE_COMMANDS,
    handlers: deps => ({
      'workspace.authorize': async (payload: { capability: string; list: MemberList }, context: { publicUserId?: string }) => {
        const namespace = channels(deps.env)
        if (!namespace) throw new FrameError('workspaces are unavailable', { code: 'not-found' })
        const { list } = payload
        if (!await verifyMemberList(keys, list)) throw new FrameError('the member list is not the owner\'s', { code: 'auth-required' })
        // The secret that never changes: a rotated session secret must not move every workspace to a new channel.
        const secret = String(deps.env.OPAQUE_USER_ID_SECRET ?? '')
        const [routeId, fingerprint, members] = await Promise.all([
          deriveScopeRouteId(secret, APP_ID, 'workspace', payload.capability),
          sha256Hex(new TextDecoder().decode(memberListBytes(list))),
          Promise.all(list.emails.map(email => deriveMemberId(secret, APP_ID, email))),
        ])
        // The owner's own session (its account holds the key that signed) decides the plan's history.
        const owner = context.publicUserId === list.ownerUserId && accountKeyIdOf(deps.sql) === list.ownerKeyId
        const plan = owner ? readMembership(deps.sql, deps.clock.nowMs()) : null
        const history = !owner ? undefined : plan?.plan === PREMIUM ? { until: plan.until } : false
        const result = await namespace.getByName(routeId).authorize({
          version: list.revision, owner: list.ownerKeyId, fingerprint, members, ...(history === undefined ? {} : { history }),
        })
        if (!result.ok) throw new FrameError(result.code ?? 'refused', { code: result.code === 'stale-authority' ? 'conflict' : 'auth-required' })
        return { routeId, history: result.history === true, expiresAt: deps.clock.nowMs() + AUTHORIZED_MS }
      },
    }),
  }
}
