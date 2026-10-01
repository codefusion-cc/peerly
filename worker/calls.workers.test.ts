import { beforeAll, describe, expect, it } from 'vitest'
import { PREMIUM } from '../shared/app.ts'
import { accountKeys, authorize, capability, connect, control, memberList, serveIssuerKeys, signIn } from './testing.workers.ts'

beforeAll(serveIssuerKeys)

describe('a workspace\'s call', () => {
  it('goes peer to peer without relays among free accounts, and gets relays when a Premium member comes', async () => {
    const [owner, member] = [await signIn(), await signIn()]
    const scope = capability()
    const list = await memberList(owner, await accountKeys(owner), scope, [owner, member])
    const routeId = (await authorize(owner, scope, list)).payload?.result.routeId as string
    const first = await connect(member, routeId)
    expect(await first.next(frame => frame.type === 'snapshot')).toMatchObject({ mediaTransport: { mode: 'p2p', relay: false }, mediaPeers: [] })

    await (await control(owner)).gateway.setMembership({ plan: PREMIUM, by: 'staff@peerly.cc' })
    const seen = first.frames.length
    await connect(owner, routeId)
    expect((await first.next(frame => frame.type === 'call' && frame.mediaTransport?.relay === true, seen)).mediaTransport)
      .toEqual({ mode: 'p2p', relay: true, reason: 'p2p' })
  })
})
