import { SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { PREMIUM, ROUTES } from '../shared/app.ts'
import { accountKeys, authorize, capability, control, join, memberList, ORIGIN, serveIssuerKeys, signIn, type Person } from './testing.workers.ts'

beforeAll(serveIssuerKeys)

const fileId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

/** A workspace of these people, entered by all of them (the owner first), with the owner on Premium or not. */
async function workspace(premium: boolean, others: Person[] = []) {
  const owner = await signIn()
  if (premium) await (await control(owner)).gateway.setMembership({ plan: PREMIUM, by: 'staff@peerly.cc' })
  const secrets = await accountKeys(owner)
  const scope = capability()
  const list = await memberList(owner, secrets, scope, [owner, ...others])
  const answer = await authorize(owner, scope, list)
  const routeId = answer.payload?.result.routeId as string
  for (const person of [owner, ...others]) expect((await join(person, routeId)).status).toBe(101)
  return { owner, routeId }
}

const path = (routeId: string, id: string) => `${ROUTES.files}${routeId}/${id}`
const put = (who: Person, routeId: string, id: string, bytes: Uint8Array) => {
  const target = path(routeId, id)
  const cookie = who.cookieFor(target)
  return SELF.fetch(`${ORIGIN}${target}`, { method: 'PUT', body: bytes, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } })
}
const get = (who: Person, routeId: string, id: string) => {
  const target = path(routeId, id)
  const cookie = who.cookieFor(target)
  return SELF.fetch(`${ORIGIN}${target}`, { headers: cookie ? { cookie } : {} })
}

describe('cloud files', () => {
  it('keeps a Premium owner\'s workspace\'s files for its members, through the session cookie', async () => {
    const member = await signIn()
    const { owner, routeId } = await workspace(true, [member])
    const id = fileId()
    const sealed = crypto.getRandomValues(new Uint8Array(2_048))
    expect((await put(member, routeId, id, sealed)).status).toBe(201)
    const read = await get(owner, routeId, id)
    expect(read.status).toBe(200)
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(sealed)
  })

  it('keeps nothing for a free owner\'s workspace: its files go between members only', async () => {
    const { owner, routeId } = await workspace(false)
    const refused = await put(owner, routeId, fileId(), new Uint8Array(10))
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ code: 'no-history' })
  })

  it('refuses someone the workspace does not list', async () => {
    const stranger = await signIn()
    const { owner, routeId } = await workspace(true)
    const id = fileId()
    expect((await put(owner, routeId, id, new Uint8Array(10))).status).toBe(201)
    expect((await get(stranger, routeId, id)).status).toBe(403)
    expect((await put(stranger, routeId, fileId(), new Uint8Array(10))).status).toBe(403)
  })
})
