import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Production's config: the bindings and migrations that matter. Preview
      // has the same Durable Objects.
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['packages/core/worker/realtime/**/*.workers.test.{mjs,ts}', 'worker/**/*.workers.test.mjs'],
    // The plugin isolates storage per file; tests also use distinct object names.
    // A file's first test also pays for starting workerd and loading the
    // Worker with @codefusion-cc/realtime: about 2 s idle, past 5 s on a busy
    // machine. The work a test does itself stays well under a second.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
