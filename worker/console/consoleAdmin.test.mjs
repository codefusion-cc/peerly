import { readdirSync, readFileSync } from 'node:fs'
import { consoleAdminErrors } from '@codefusion-cc/console/worker'
import { parseManifest } from '@codefusion-cc/console'
import { describe, expect, it, vi } from 'vitest'
import worker, { ConsoleAdmin as exported } from '../index.mjs'
import { ConsoleAdmin } from './consoleAdmin.mjs'
import manifest from './manifest.json' with { type: 'json' }
import { readWranglerConfig } from '../testing/wranglerConfig.mjs'

// The console's config/apps.json names Peerly `peerly`, binds the production
// Worker `peerly` as PEERLY_ADMIN with entrypoint ConsoleAdmin, and maps the
// Workers `peerly` and `peerly-preview` to production and staging. A rename
// on either side breaks the Secrets page without any error here, so the names
// are pinned.

// Every `env.NAME` the Worker's own code reads (tests aside), so a declared
// name with a typo shows up here.
const workerSources = [new URL('../', import.meta.url), new URL('worker/', import.meta.resolve('@peerly/core/package.json'))].flatMap(root =>
  readdirSync(root, { recursive: true })
    .filter(file => file.endsWith('.mjs') && !file.includes('.test.'))
    .map(file => readFileSync(new URL(file, root), 'utf8')),
)
const workerReads = new Set(workerSources.flatMap(source => [...source.matchAll(/env\??\.([A-Z][A-Z0-9_]*)/g)].map(m => m[1])))

// What the relay and coturn need; the Worker stops reading them once
// production runs on Durable Objects and Cloudflare Realtime TURN.
const RETIRED = ['RELAY_TICKET_SECRET', 'RELAY_TICKET_AUDIENCE', 'RELAY_TICKET_AUDIENCES', 'TURN_AUTH_SECRET', 'TURN_URLS']
// Read by @codefusion-cc/realtime-media (generateTurnCredentials, turnConfigured)
// from the env Peerly passes it, not by Peerly's own code.
const READ_BY_REALTIME_MEDIA = ['TURN_KEY_ID', 'TURN_KEY_API_TOKEN']

const OWNER = { email: 'owner@example.com', permissions: ['records:read', 'records:moderate', 'records:manage', 'pii:read', 'telemetry:read'] }

describe('the console manifest', () => {
  it('is a valid manifest with a handler for everything it declares', () => {
    expect(parseManifest(manifest).ok).toBe(true)
    expect(consoleAdminErrors({ manifest, resources: {} })).toEqual([])
  })

  it('names the app as the console does', () => {
    expect(manifest.app).toEqual({ id: 'peerly', name: 'Peerly' })
  })

  // Random values are base64url: NETWORK_SESSION_SECRET rotates as new:old (crypto.mjs), and a colon inside one
  // would cut it in two.
  it('declares the secrets that stay after the move to Durable Objects and Realtime TURN, each made the way it must be', () => {
    const { manifest: parsed } = parseManifest(manifest)
    expect(Object.fromEntries(parsed.secrets.map(s => [s.name, { required: s.required, source: s.source }]))).toEqual({
      NETWORK_SESSION_SECRET: { required: true, source: { kind: 'random', bytes: 32, encoding: 'base64url' } },
      OPAQUE_USER_ID_SECRET: { required: true, source: { kind: 'random', bytes: 32, encoding: 'base64url' } },
      RENDEZVOUS_SECRET: { required: true, source: { kind: 'random', bytes: 32, encoding: 'base64url' } },
      TURN_KEY_ID: { required: true, source: { kind: 'provider', resource: 'cloudflare-turn-key', part: 'id' } },
      TURN_KEY_API_TOKEN: { required: true, source: { kind: 'provider', resource: 'cloudflare-turn-key', part: 'token' } },
    })
  })

  it('declares every other secret the staging Worker requires', () => {
    const required = readWranglerConfig('wrangler.preview.jsonc').secrets.required.filter(name => !RETIRED.includes(name))
    expect(required.length).toBeGreaterThan(0)
    for (const name of required) expect(manifest.secrets.map(s => s.name)).toContain(name)
  })

  it('declares only names the Worker reads', () => {
    for (const { name } of manifest.secrets) {
      if (!READ_BY_REALTIME_MEDIA.includes(name)) expect(workerReads, name).toContain(name)
    }
  })

})

describe('ConsoleAdmin', () => {
  it('is the entrypoint the Worker exports, as the console\'s binding names it', () => {
    expect(exported).toBe(ConsoleAdmin)
  })

  it('has no records to list, read or act on, even for an owner', async () => {
    const admin = new ConsoleAdmin({}, {})
    await expect(admin.list('accounts', {}, OWNER)).rejects.toThrow('unknown resource "accounts"')
    await expect(admin.runAction({ resource: 'accounts', action: 'ban', ids: ['a'], actor: OWNER })).rejects.toThrow('unknown resource')
  })
})

describe('reaching the admin from the web', () => {
  const { vars } = readWranglerConfig('wrangler.jsonc')

  it.each([
    '/ConsoleAdmin', '/api/console/manifest', '/_console/manifest',
  ])('%s is not the admin: it is left to the static assets', async path => {
    const assets = vi.fn(async () => new Response('asset', { status: 404 }))
    const response = await worker.fetch(new Request(`https://peerly.cc${path}`), { ...vars, ASSETS: { fetch: assets } }, {})
    const body = await response.text()
    expect(assets).toHaveBeenCalledTimes(1)
    expect(body).toBe('asset')
    for (const secret of manifest.secrets) expect(body).not.toContain(secret.name)
  })
})

describe('the Worker configs the console relies on', () => {
  it.each([
    ['wrangler.jsonc', 'peerly'],
    ['wrangler.preview.jsonc', 'peerly-preview'],
  ])('%s deploys %s and sends its invocations to the console', (file, name) => {
    const config = readWranglerConfig(file)
    expect(config.name).toBe(name)
    expect(config.tail_consumers).toEqual([{ service: 'codefusion-console' }])
  })
})
