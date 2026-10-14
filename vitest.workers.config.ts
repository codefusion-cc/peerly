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
    // The setup file starts the Durable Objects before a file's first test,
    // which on a busy machine takes longer than any test's own work.
    setupFiles: ['worker/testing/warmWorker.mjs'],
    hookTimeout: 30_000,
    testTimeout: 10_000,
  },
})
