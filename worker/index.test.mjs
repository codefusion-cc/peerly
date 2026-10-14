import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { MEDIA_HEALTH_CRON, MEDIA_HEALTH_PATH } from '@codefusion-cc/realtime-media'
import { LIMITS } from '@codefusion-cc/realtime'
import * as workerModule from './index.mjs'
import worker, { allowedAuthParent } from './index.mjs'
import { resolveContentBackend } from '../src/config.ts'
import { readWranglerConfig } from './testing/wranglerConfig.mjs'
import { signInState } from '@codefusion-cc/google-sign-in/testing'

const previewConfig = readWranglerConfig('wrangler.preview.jsonc')
const productionConfig = readWranglerConfig('wrangler.jsonc')
const e2eConfig = readWranglerConfig('wrangler.e2e.jsonc')

describe('deployment profiles', () => {
  it('runs production on the Durable Objects with messages and files peer to peer', async () => {
    expect(resolveContentBackend(undefined)).toBe(productionConfig.vars.CONTENT_BACKEND)
    expect(productionConfig.vars.CONTENT_BACKEND).toBe('p2p')
    expect(productionConfig.vars).not.toHaveProperty('COORDINATION_BACKEND')
    const response = await worker.fetch(new Request('https://peerly.cc/api/realtime/content/test'),
      productionConfig.vars, {})
    expect(response.status).toBe(503)
  })

  it('keeps messages and files on the server on preview.peerly.cc only', () => {
    expect(previewConfig.assets.directory).not.toBe(productionConfig.assets.directory)
    expect(previewConfig.assets.directory).toBe('./dist-preview')
    expect(previewConfig.build.command).toContain('npm run build:preview')
    expect(previewConfig.routes).toContainEqual({ pattern: 'preview.peerly.cc', custom_domain: true })
    expect(resolveContentBackend('durable-objects')).toBe(previewConfig.vars.CONTENT_BACKEND)
    expect(previewConfig.build.command).toContain('VITE_CONTENT_BACKEND=durable-objects')
  })

  for (const [name, config] of [['production', productionConfig], ['preview', previewConfig]]) {
    it(`gives ${name} every Durable Object the worker exports, created by its migrations`, () => {
      const classes = ['UserGatewayDO', 'SignalScopeDO', 'ContentChannelDO', 'LobbyChannelDO']
      for (const className of classes) expect(typeof workerModule[className]).toBe('function')
      expect(config.durable_objects.bindings.map(binding => binding.class_name).sort()).toEqual([...classes].sort())
      const live = new Set()
      for (const migration of config.migrations) {
        for (const created of migration.new_sqlite_classes ?? []) live.add(created)
        for (const deleted of migration.deleted_classes ?? []) live.delete(deleted)
      }
      expect([...live].sort()).toEqual([...classes].sort())
    })

    it(`requires ${name}'s secrets, the Cloudflare TURN key among them, and stores none`, () => {
      expect(config.secrets.required).toEqual(expect.arrayContaining([
        'RENDEZVOUS_SECRET', 'NETWORK_SESSION_SECRET', 'OPAQUE_USER_ID_SECRET', 'TURN_KEY_ID', 'TURN_KEY_API_TOKEN',
      ]))
      expect(config.secrets.required).not.toContain('TURN_AUTH_SECRET')
      for (const secret of config.secrets.required) expect(config.vars).not.toHaveProperty(secret)
    })

    it(`checks ${name}'s TURN key on the media health schedule`, () => {
      expect(config.triggers.crons).toContain(MEDIA_HEALTH_CRON)
      expect(config.ratelimits.map(limit => limit.name)).toEqual(expect.arrayContaining([
        'MEDIA_RATE_LIMITER', 'RENDEZVOUS_RATE_LIMITER', 'AUTH_RATE_LIMITER', 'AUTH_IP_RATE_LIMITER',
      ]))
    })
  }

  for (const [name, config] of [['production', productionConfig], ['preview', previewConfig], ['e2e', e2eConfig]]) {
    it(`gives ${name} the rate limits the realtime routes require, at the package's ceilings`, () => {
      const limit = binding => config.ratelimits.find(entry => entry.name === binding)?.simple
      // The package throws on a sign-in or identity request when one of these is missing.
      expect(limit('AUTH_RATE_LIMITER')).toEqual({ limit: LIMITS.authRequestsPerMinute, period: 60 })
      expect(limit('AUTH_IP_RATE_LIMITER')).toEqual({ limit: LIMITS.authRequestsPerMinutePerIp, period: 60 })
      expect(limit('IDENTITY_RATE_LIMITER')).toEqual({ limit: 30, period: 60 })
    })
  }

  it('gives every rate limit its own counter across both deployments', () => {
    const ids = [...productionConfig.ratelimits, ...previewConfig.ratelimits].map(limit => limit.namespace_id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('points neither deployment at the old relay or TURN server', () => {
    for (const file of ['../wrangler.jsonc', '../wrangler.preview.jsonc']) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(text).not.toMatch(/relay\.peerly\.cc|turn\.peerly\.cc|VITE_SIGNALING|VITE_RELAY|TURN_URLS|ws-relay/)
    }
  })
})

describe('media health', () => {
  const turnKey = { TURN_KEY_ID: 'key-id', TURN_KEY_API_TOKEN: 'api-token' }
  const iceAnswer = () => new Response(JSON.stringify({
    iceServers: [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }],
  }), { status: 201 })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reports a deployment without a TURN key on every scheduled run', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await worker.scheduled({ cron: MEDIA_HEALTH_CRON }, {}, {})
    expect(fetcher).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^media health: no TURN key/))
  })

  it('asks Cloudflare for credentials on a scheduled run and stays quiet when they come', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn(async () => iceAnswer())
    vi.stubGlobal('fetch', fetcher)
    await worker.scheduled({ cron: MEDIA_HEALTH_CRON }, turnKey, {})
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers')
    expect(errors).not.toHaveBeenCalled()
  })

  it('answers the public health check without handing out credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => iceAnswer()))
    const response = await worker.fetch(new Request(`https://peerly.cc${MEDIA_HEALTH_PATH}`), turnKey, {})
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text).turn.ok).toBe(true)
    expect(text).not.toContain('credential')
  })
})

describe('Peerly sign-in origins and Google’s return', () => {
  it('accepts production and exact HTTPS Peerly branch preview origins', () => {
    expect(allowedAuthParent('https://peerly.cc')).toBe(true)
    expect(allowedAuthParent('https://preview.peerly.cc')).toBe(true)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.workers.dev')).toBe(true)
    // worker.dev is not Cloudflare's: someone else owns it, and a sign-in must never hand them a token.
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.worker.dev')).toBe(false)
    expect(allowedAuthParent('http://fix-auth-peerly.codefusion.workers.dev')).toBe(false)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.workers.dev/path')).toBe(false)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.workers.dev.evil.test')).toBe(false)
    // Both staging shapes on our own zone: `<label>.preview` and
    // `<label>-preview`. Only the first was accepted before, so a worker at
    // dev-preview.peerly.cc had every /api/network/* request 403'd.
    expect(allowedAuthParent('https://branch.preview.peerly.cc')).toBe(true)
    expect(allowedAuthParent('https://dev-preview.peerly.cc')).toBe(true)
    expect(allowedAuthParent('https://dev-preview.peerly.cc.evil.test')).toBe(false)
    expect(allowedAuthParent('https://evil.dev-preview.peerly.cc')).toBe(false)
  })

  const handOff = (state, { site = 'same-origin', token = 'aaa.bbb.ccc' } = {}) => worker.fetch(
    new Request('https://peerly.cc/api/auth/google/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': site },
      body: new URLSearchParams({ state, id_token: token }),
    }),
    productionConfig.vars,
    { waitUntil() {} }
  )

  it('serves Google’s return page in Peerly’s background, scripts allowed by hash only', async () => {
    const response = await worker.fetch(new Request('https://peerly.cc/api/auth/google/callback'), productionConfig.vars, { waitUntil() {} })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toMatch(/^default-src 'none'/)
    const html = await response.text()
    expect(html).toContain('#111221')
    expect(html).toContain('Signing in to Peerly…')
  })

  it('hands a token on only to the login page of Peerly or an allowed preview', async () => {
    const own = await handOff(signInState('https://peerly.cc', '/login'))
    expect(new URL((await own.json()).location).origin).toBe('https://peerly.cc')
    const preview = await handOff(signInState('https://fix-auth-peerly.codefusion.workers.dev', '/login'))
    const location = new URL((await preview.json()).location)
    expect(location.origin).toBe('https://fix-auth-peerly.codefusion.workers.dev')
    expect(new URLSearchParams(location.hash.slice(1)).get('google_id_token')).toBe('aaa.bbb.ccc')

    expect((await handOff(signInState('https://evil.test', '/login'))).status).toBe(400)
    expect((await handOff(signInState('https://x-peerly.codefusion.worker.dev', '/login'))).status).toBe(400)
    expect((await handOff(signInState('https://peerly.cc', '/workspace/x'))).status).toBe(400)
    expect((await handOff(signInState('https://peerly.cc', '/login'), { site: 'cross-site' })).status).toBe(403)
  })
})
