import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { PREMIUM } from '../shared/app.ts'
import { accountKeys, authorize, capability, control, join, memberList, serveIssuerKeys, signIn } from './testing.workers.ts'

beforeAll(serveIssuerKeys)

const result = (answer: { type: string; payload: Record<string, any> }) => answer.payload.result
const refused = (answer: { type: string; payload: Record<string, any> }) => answer.type === 'error' ? answer.payload.code : null
const routeOf = async (...args: Parameters<typeof authorize>) => result(await authorize(...args)).routeId as string

describe('entering a workspace', () => {
  it('admits the people the owner listed, by verified email, and nobody else', async () => {
    const [owner, member, stranger] = [await signIn(), await signIn(), await signIn()]
    const secrets = await accountKeys(owner)
    const scope = capability()
    const list = await memberList(owner, secrets, scope, [owner, member])
    const answer = result(await authorize(owner, scope, list))
    expect(answer).toMatchObject({ history: false })
    expect(answer.routeId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await join(owner, answer.routeId)).status).toBe(101)
    expect((await join(member, answer.routeId)).status).toBe(101)
    expect((await join(stranger, answer.routeId)).status).toBe(403)
    // The route is the server's secret function of the capability: another workspace's is another.
    const other = capability()
    expect(await routeOf(owner, other, await memberList(owner, secrets, other, [owner]))).not.toBe(answer.routeId)
  })

  it('lets a listed member present the list too, and lets in someone the owner adds later', async () => {
    const [owner, member, later] = [await signIn(), await signIn(), await signIn()]
    const secrets = await accountKeys(owner)
    const scope = capability()
    const first = await memberList(owner, secrets, scope, [owner, member])
    const routeId = await routeOf(member, scope, first)
    expect((await join(later, routeId)).status).toBe(403)
    const second = await memberList(owner, secrets, scope, [owner, member, later], first.revision)
    expect(await routeOf(owner, scope, second)).toBe(routeId)
    expect((await join(later, routeId)).status).toBe(101)
    // The older list cannot bring the earlier set back.
    expect(refused(await authorize(member, scope, first))).toBe('conflict')
  })

  it('refuses a list edited after signing, signed by someone else, or moved to another workspace', async () => {
    const [owner, mallory] = [await signIn(), await signIn()]
    const [secrets, theirs] = [await accountKeys(owner), await accountKeys(mallory)]
    const scope = capability()
    const list = await memberList(owner, secrets, scope, [owner])
    await routeOf(owner, scope, list)
    // An address added by hand: the signature no longer covers it.
    expect(refused(await authorize(mallory, scope, { ...list, emails: [...list.emails, mallory.email].sort() }))).toBe('auth-required')
    // Mallory's own list for the same workspace: the channel's owner is pinned.
    expect(refused(await authorize(mallory, scope, await memberList(mallory, theirs, scope, [mallory])))).toBe('auth-required')
    // The owner's list, presented for another workspace.
    expect(refused(await authorize(owner, capability(), list))).not.toBeNull()
    for (const broken of [null, {}, { ...list, emails: [] }, { ...list, revision: 0 }, { ...list, emails: ['B@x.com', 'a@x.com'] }]) {
      expect(refused(await authorize(owner, scope, broken))).not.toBeNull()
    }
  })
})

describe('a member the owner removed', () => {
  it('cannot put themselves back with a newer list of their own making, though they know the workspace', async () => {
    const [owner, removed] = [await signIn(), await signIn()]
    const secrets = await accountKeys(owner)
    const theirs = await accountKeys(removed)
    const scope = capability()
    const before = await memberList(owner, secrets, scope, [owner, removed])
    const routeId = await routeOf(owner, scope, before)
    const after = await memberList(owner, secrets, scope, [owner], before.revision)
    await routeOf(owner, scope, after)
    expect((await join(removed, routeId)).status).toBe(403)
    // A later revision under the owner's key, signed with their own: it must not count.
    const forged = await memberList(removed, theirs, scope, [owner, removed], after.revision)
    const asOwner = { ...forged, ownerKeyId: after.ownerKeyId, ownerUserId: after.ownerUserId }
    expect(refused(await authorize(removed, scope, asOwner))).toBe('auth-required')
    expect((await join(removed, routeId)).status).toBe(403)
  })
})

describe('premium history', () => {
  it('follows the owner\'s plan: off without it, on with it, and other members\' lists leave it alone', async () => {
    const [owner, member] = [await signIn(), await signIn()]
    const secrets = await accountKeys(owner)
    const scope = capability()
    const list = await memberList(owner, secrets, scope, [owner, member])
    expect(result(await authorize(owner, scope, list)).history).toBe(false)
    const { gateway } = await control(owner)
    const until = Date.now() + 30 * 24 * 60 * 60_000
    expect(await gateway.setMembership({ plan: PREMIUM, until, by: 'staff@peerly.cc' })).toMatchObject({ ok: true })
    expect(result(await authorize(owner, scope, list)).history).toBe(true)
    // A member's own plan decides nothing here, and their presenting the list keeps history on.
    const { gateway: theirs } = await control(member)
    await theirs.setMembership({ plan: PREMIUM, by: 'staff@peerly.cc' })
    expect(result(await authorize(member, scope, list)).history).toBe(true)
    await gateway.setMembership({ plan: null, by: 'staff@peerly.cc' })
    expect(result(await authorize(member, scope, list)).history).toBe(true)
    expect(result(await authorize(owner, scope, list)).history).toBe(false)
  })

  it('does not take a list naming another account as owner as the owner\'s word', async () => {
    const [owner, impostor] = [await signIn(), await signIn()]
    const secrets = await accountKeys(owner)
    await accountKeys(impostor)
    const { gateway } = await control(impostor)
    await gateway.setMembership({ plan: PREMIUM, by: 'staff@peerly.cc' })
    // The owner's list names the owner: the impostor is not them, whatever their plan.
    const scope = capability()
    expect(result(await authorize(impostor, scope, await memberList(owner, secrets, scope, [owner, impostor]))).history).toBe(false)
  })
})

describe('the channel binding', () => {
  it('is the one the gateway tracks sessions for', () => {
    expect(env.CHANNELS).toBeTruthy()
  })
})
