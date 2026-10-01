import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PREMIUM } from '../shared/app.ts'
import { handleIceServers } from './ice.ts'
import { control, ORIGIN, serveIssuerKeys, signIn } from './testing.workers.ts'

beforeAll(serveIssuerKeys)

const TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys/turn-key/credentials/generate-ice-servers'
const turnAnswer = { iceServers: [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }] }

/** The route with TURN configured and Cloudflare's API answering `answer`; counts what it was asked. */
function withTurn(answer: () => Response, limit: { success: boolean } = { success: true }) {
  const asked: string[] = []
  const real = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === TURN_API) { asked.push(url); return answer() }
    return real(input, init)
  })
  const turnEnv = { ...env, TURN_KEY_ID: 'turn-key', TURN_KEY_API_TOKEN: 'secret', MEDIA_RATE_LIMITER: { limit: async () => limit } }
  return { asked, ask: (cookie?: string, method = 'GET') => handleIceServers(new Request(`${ORIGIN}/api/media/ice`, { method, headers: cookie ? { cookie } : {} }), turnEnv as never) }
}
const premium = async () => {
  const person = await signIn()
  const { gateway } = await control(person)
  await gateway.setMembership({ plan: PREMIUM, by: 'staff@peerly.cc' })
  return person
}

describe('ICE servers', () => {
  it('gives a premium account TURN as well as STUN', async () => {
    const person = await premium()
    const turn = withTurn(() => Response.json(turnAnswer, { status: 201 }))
    const body = await (await turn.ask(person.cookie)).json() as { iceServers: Array<{ urls: string | string[] }>; relay: boolean; ttlMs: number }
    expect(body.relay).toBe(true)
    expect(body.iceServers.flatMap(server => server.urls)).toContain('turn:turn.cloudflare.com:3478?transport=udp')
    expect(body.ttlMs).toBeGreaterThan(0)
  })

  it('gives everyone else STUN only, without asking Cloudflare for credentials', async () => {
    const person = await signIn()
    const turn = withTurn(() => Response.json(turnAnswer, { status: 201 }))
    const body = await (await turn.ask(person.cookie)).json() as { iceServers: Array<{ urls: string[] }>; relay: boolean }
    expect(body.relay).toBe(false)
    expect(body.iceServers.flatMap(server => server.urls).every(url => url.startsWith('stun:'))).toBe(true)
    expect(turn.asked).toEqual([])
  })

  it('falls back to STUN when Cloudflare\'s TURN fails, and says how long to wait when an account asks too often', async () => {
    const person = await premium()
    expect(await (await withTurn(() => new Response('down', { status: 500 })).ask(person.cookie)).json()).toMatchObject({ relay: false })
    const limited = await withTurn(() => Response.json(turnAnswer, { status: 201 }), { success: false }).ask(person.cookie)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
  })

  it('answers only a signed-in GET', async () => {
    const turn = withTurn(() => Response.json(turnAnswer, { status: 201 }))
    expect((await turn.ask()).status).toBe(401)
    expect((await turn.ask('pnet=forged')).status).toBe(401)
    expect((await turn.ask((await signIn()).cookie, 'POST')).status).toBe(405)
  })
})
