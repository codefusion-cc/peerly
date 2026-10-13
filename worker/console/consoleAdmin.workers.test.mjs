import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import manifest from './manifest.json' with { type: 'json' }

// The bundled Worker in workerd, called over RPC as the console's PEERLY_ADMIN
// binding calls it (entrypoint ConsoleAdmin). The plain-Node tests next to
// this one pin the manifest's content; this one proves the deployed shape.
describe('ConsoleAdmin over RPC', () => {
  it('serves the manifest the console reads the secrets from', async () => {
    expect(await exports.ConsoleAdmin.manifest()).toEqual(manifest)
  })
})
