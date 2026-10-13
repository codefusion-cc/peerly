import { readFileSync } from 'node:fs'
import { consoleAdminErrors } from '@codefusion-cc/console/worker'
import { parseManifest } from '@codefusion-cc/console'
import { describe, expect, it, vi } from 'vitest'
import worker, { ConsoleAdmin as exported } from '../index.mjs'
import { ConsoleAdmin } from './consoleAdmin.mjs'
import manifest from './manifest.json' with { type: 'json' }

// The console's config/apps.json names Peerly `peerly`, binds the production
// Worker `peerly` as PEERLY_ADMIN with entrypoint ConsoleAdmin, and maps the
// Workers `peerly` and `peerly-preview` to production and staging. A rename
// on either side breaks the Secrets page without any error here, so the names
// are pinned.
const jsonc = file => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
  .replace(/^\s*\/\/.*$/gm, ''))

const OWNER = { email: 'owner@example.com', permissions: ['records:read', 'records:moderate', 'records:manage', 'pii:read', 'telemetry:read'] }

describe('the console manifest', () => {
  it('is a valid manifest with a handler for everything it declares', () => {
    expect(parseManifest(manifest).ok).toBe(true)
    expect(consoleAdminErrors({ manifest, resources: {} })).toEqual([])
  })

  it('names the app as the console does', () => {
    expect(manifest.app).toEqual({ id: 'peerly', name: 'Peerly' })
  })

  it('declares exactly the secrets the Worker keeps, each made the way it must be', () => {
    const { manifest: parsed } = parseManifest(manifest)
    expect(Object.fromEntries(parsed.secrets.map(s => [s.name, { required: s.required, source: s.source }]))).toEqual({
      NETWORK_SESSION_SECRET: { required: true, source: { kind: 'random', bytes: 32, encoding: 'base64url' } },
      OPAQUE_USER_ID_SECRET: { required: true, source: { kind: 'random', bytes: 32, encoding: 'base64url' } },
      RENDEZVOUS_SECRET: { required: true, source: { kind: 'random', bytes: 32, encoding: 'base64url' } },
      TURN_KEY_ID: { required: true, source: { kind: 'provider', resource: 'cloudflare-turn-key', part: 'id' } },
      TURN_KEY_API_TOKEN: { required: true, source: { kind: 'provider', resource: 'cloudflare-turn-key', part: 'token' } },
    })
  })

  it('makes random secrets that NETWORK_SESSION_SECRET\'s new:old rotation can split', () => {
    // crypto.mjs reads `current:previous`; a colon inside a generated value
    // would cut it in two. base64url and hex never contain one.
    for (const secret of parseManifest(manifest).manifest.secrets) {
      if (secret.source.kind === 'random') expect(['base64url', 'hex']).toContain(secret.source.encoding)
    }
  })

  it('warns before a new account id key cuts accounts off their stored data', () => {
    const opaque = manifest.secrets.find(s => s.name === 'OPAQUE_USER_ID_SECRET')
    expect(opaque.description).toMatch(/only where it is missing/)
  })
})

describe('ConsoleAdmin', () => {
  it('is the entrypoint the Worker exports, as the console\'s binding names it', () => {
    expect(exported).toBe(ConsoleAdmin)
  })

  it('answers the console with the manifest', async () => {
    const admin = new ConsoleAdmin({}, {})
    expect(await admin.manifest()).toEqual(manifest)
  })

  it('has no records to list, read or act on, whoever asks', async () => {
    const admin = new ConsoleAdmin({}, {})
    for (const actor of [OWNER, { email: 'nobody@example.com', permissions: [] }, undefined]) {
      await expect(admin.list('accounts', {}, actor)).rejects.toThrow('unknown resource "accounts"')
      await expect(admin.get('secrets', 'TURN_KEY_ID', actor)).rejects.toThrow('unknown resource "secrets"')
      await expect(admin.runAction({ resource: 'accounts', action: 'ban', ids: ['a'], actor })).rejects.toThrow('unknown resource')
    }
  })
})

describe('reaching the admin from the web', () => {
  const env = { ...jsonc('wrangler.jsonc').vars }

  it.each([
    '/ConsoleAdmin', '/api/console', '/api/console/manifest', '/api/admin/manifest',
    '/_console/manifest', '/manifest.json', '/api/manifest',
  ])('%s is not the admin: it is left to the static assets', async path => {
    const assets = vi.fn(async () => new Response('asset', { status: 404 }))
    const response = await worker.fetch(new Request(`https://peerly.cc${path}`), { ...env, ASSETS: { fetch: assets } }, {})
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
    const config = jsonc(file)
    expect(config.name).toBe(name)
    expect(config.tail_consumers).toEqual([{ service: 'codefusion-console' }])
  })
})
