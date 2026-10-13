import { afterEach, describe, expect, it, vi } from 'vitest'
import { issueIceServers, TURN_WAIT_MS } from './ice.mjs'

const CLOUDFLARE_STUN = { urls: ['stun:stun.cloudflare.com:3478'] }
const turnKey = { TURN_KEY_ID: 'turn-key-id', TURN_KEY_API_TOKEN: 'turn-api-token' }
const answer = () => new Response(JSON.stringify({
  iceServers: [{ urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }],
}), { status: 201 })

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('issueIceServers', () => {
  it('adds Cloudflare TURN to STUN, expiring with the credentials', async () => {
    const fetcher = vi.fn(async () => answer())
    await expect(issueIceServers(turnKey, { fetcher })).resolves.toEqual({
      servers: [CLOUDFLARE_STUN, { urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }],
      ttlMs: 3_600_000,
    })
  })

  it.each([
    ['no key at all', {}],
    ['a key id without its token', { TURN_KEY_ID: 'turn-key-id' }],
    ['a blank token', { TURN_KEY_ID: 'turn-key-id', TURN_KEY_API_TOKEN: '  ' }],
    ['a key id that is not one', { TURN_KEY_ID: '../keys', TURN_KEY_API_TOKEN: 'turn-api-token' }],
  ])('gives STUN alone, without asking Cloudflare, for %s', async (_case, env) => {
    const fetcher = vi.fn()
    await expect(issueIceServers(env, { fetcher })).resolves.toEqual({ servers: [CLOUDFLARE_STUN] })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('stops waiting for a slow Cloudflare after TURN_WAIT_MS and gives STUN', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn(() => new Promise(() => {}))
    let settled
    const issuing = issueIceServers(turnKey, { fetcher }).then(value => { settled = value })
    await vi.advanceTimersByTimeAsync(TURN_WAIT_MS - 1)
    expect(settled).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await issuing
    expect(settled).toEqual({ servers: [CLOUDFLARE_STUN] })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`within ${TURN_WAIT_MS} ms`))
  })

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
    ['a refused key', async () => new Response('denied', { status: 401 })],
    ['a malformed answer', async () => new Response('{"iceServers":', { status: 201 })],
    ['no servers', async () => new Response('{"iceServers":[]}', { status: 201 })],
    ['a server that is not Cloudflare\'s', async () => new Response(JSON.stringify({
      iceServers: [{ urls: ['turn:turn.peerly.cc:3478'], username: 'u', credential: 'c' }],
    }), { status: 201 })],
  ])('gives STUN and logs on %s', async (_case, respond) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(issueIceServers(turnKey, { fetcher: vi.fn(respond) })).resolves.toEqual({ servers: [CLOUDFLARE_STUN] })
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^turn: .*the session got STUN only$/))
  })

  it('logs nothing that carries the API token', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await issueIceServers(turnKey, { fetcher: vi.fn(async () => new Response('turn-api-token', { status: 500 })) })
    expect(JSON.stringify(errors.mock.calls)).not.toContain('turn-api-token')
  })
})
