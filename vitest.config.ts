import { fileURLToPath } from 'url'
import { configDefaults, defineConfig } from 'vitest/config'
import { buildDefines } from './build-info.mjs'
import { packageSources } from './source-conditions.ts'

export default defineConfig({
  plugins: [packageSources()],
  define: buildDefines(),
  resolve: {
    alias: [
      // worker/index.test.mjs runs in plain Node, not the Workers runtime, so
      // the Durable Object classes it reaches get `DurableObject` from the
      // console package's stand-in. Real behavior is covered by
      // pnpm run test:workers.
      { find: 'cloudflare:workers', replacement: fileURLToPath(import.meta.resolve('@codefusion-cc/console/testing/cloudflare-workers')) },
    ],
  },
  test: {
    environment: 'node',
    // Bundled rather than loaded by Node, so the cloudflare:workers alias above
    // reaches the media package's Durable Object and the console it reports to
    // (worker/console/consoleAdmin.mjs).
    server: { deps: { inline: ['@codefusion-cc/realtime-media', '@codefusion-cc/realtime', '@codefusion-cc/console'] } },
    include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.mjs'],
    // pnpm run test:workers runs these in workerd.
    exclude: [...configDefaults.exclude, '**/*.workers.test.*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/collab/friendInvite.ts',
      ],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 65 },
    },
  },
})
