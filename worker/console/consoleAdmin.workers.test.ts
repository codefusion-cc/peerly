import { consoleAdminErrors } from '@codefusion-cc/console/worker'
import { createExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { control, serveIssuerKeys, signIn, type Person } from '../testing.workers.ts'
import { ConsoleAdmin, GRANT_LENGTHS } from './consoleAdmin.ts'
import manifest from './manifest.json'

beforeAll(serveIssuerKeys)

const DAY = 24 * 60 * 60_000
const staff = { memberId: 'm1', email: 'staff@peerly.cc', role: 'admin' as const, permissions: ['records:read', 'records:manage'] as never[] }
const reader = { ...staff, email: 'reader@peerly.cc', permissions: ['records:read'] as never[] }

/** The entrypoint as the console's service binding reaches it. */
const admin = () => new ConsoleAdmin(createExecutionContext() as never, env as never)

/** Someone signed in whose page has read its plan, which lists them; with their open control socket. */
async function listed(): Promise<{ person: Person; socket: Awaited<ReturnType<typeof control>>['socket'] }> {
  const person = await signIn()
  const { socket } = await control(person)
  await socket.command('membership.read', {})
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await admin().get('accounts', person.userId, reader)) return { person, socket }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('never listed')
}

describe('Peerly in CodeFusion Console', () => {
  it('has a handler for everything its manifest declares', () => {
    expect(consoleAdminErrors({ manifest, resources: { accounts: { list: () => ({ items: [] }), get: () => null, actions: { 'grant-premium': () => ({ ok: true }), 'end-premium': () => ({ ok: true }) } } } })).toEqual([])
    expect(Object.keys(GRANT_LENGTHS).sort()).toEqual(manifest.resources[0].actions[0].inputs![0].options!.map(option => option.value).sort())
  })

  it('finds an account by its id, grants premium for a year, tells its tabs, and ends it', async () => {
    const { person, socket } = await listed()
    expect(await admin().get('accounts', person.userId, reader)).toMatchObject({ userId: person.userId, plan: 'free', planUntil: null })
    const found = await admin().list('accounts', { search: person.userId.slice(0, 10), limit: 25 }, reader)
    expect(found.items.map(item => item.userId)).toContain(person.userId)

    const heard = socket.nextEvent('account.membership')
    const before = Date.now()
    expect(await admin().runAction({ resource: 'accounts', action: 'grant-premium', ids: [person.userId], input: { length: '1y', note: 'beta tester' }, actor: staff }))
      .toEqual({ ok: true, message: 'Premium granted' })
    expect(await heard).toMatchObject({ plan: 'premium' })
    const granted = await admin().get('accounts', person.userId, reader)
    expect(granted).toMatchObject({ plan: 'premium', grantedBy: 'staff@peerly.cc' })
    expect(granted!.planUntil).toBeGreaterThanOrEqual(before + 366 * DAY)
    expect(granted!.planUntil).toBeLessThanOrEqual(Date.now() + 366 * DAY)
    expect((await admin().list('accounts', { filters: { plan: 'premium' }, limit: 100 }, reader)).items.map(item => item.userId)).toContain(person.userId)
    expect((await admin().list('accounts', { filters: { plan: 'free' }, limit: 100 }, reader)).items.map(item => item.userId)).not.toContain(person.userId)

    const ended = socket.nextEvent('account.membership')
    expect(await admin().runAction({ resource: 'accounts', action: 'end-premium', ids: [person.userId], input: {}, reason: 'refund', actor: staff }))
      .toEqual({ ok: true, message: 'Premium ended' })
    expect(await ended).toMatchObject({ plan: null })
    expect(await admin().get('accounts', person.userId, reader)).toMatchObject({ plan: 'free' })
    socket.close()
  })

  it('grants with no end date, and to several accounts at once', async () => {
    const [ann, bob] = await Promise.all([listed(), listed()])
    expect(await admin().runAction({ resource: 'accounts', action: 'grant-premium', ids: [ann.person.userId, bob.person.userId], input: { length: 'forever' }, actor: staff }))
      .toEqual({ ok: true, message: 'Premium granted to 2 accounts' })
    for (const { person, socket } of [ann, bob]) {
      expect(await admin().get('accounts', person.userId, reader)).toMatchObject({ plan: 'premium', planUntil: null })
      socket.close()
    }
  })

  it('refuses what staff may not do, an unknown length, an end without a reason, and accounts it does not know', async () => {
    const { person, socket } = await listed()
    expect(await admin().runAction({ resource: 'accounts', action: 'grant-premium', ids: [person.userId], input: { length: '1y' }, actor: reader }))
      .toMatchObject({ ok: false, message: 'Not allowed' })
    expect(await admin().runAction({ resource: 'accounts', action: 'grant-premium', ids: [person.userId], input: { length: '10y' }, actor: staff }))
      .toEqual({ ok: false, message: 'Choose how long' })
    expect(await admin().runAction({ resource: 'accounts', action: 'end-premium', ids: [person.userId], input: {}, actor: staff }))
      .toMatchObject({ ok: false, message: 'Give a reason' })
    expect(await admin().runAction({ resource: 'accounts', action: 'grant-premium', ids: ['unknownAccount0001'], input: { length: '1m' }, actor: staff }))
      .toEqual({ ok: false, message: 'No such account' })
    expect(await admin().get('accounts', person.userId, reader)).toMatchObject({ plan: 'free' })
    await expect(admin().list('accounts', { limit: 25 }, { ...reader, permissions: [] })).rejects.toThrow(/permission/)
    socket.close()
  })
})
