import { fileURLToPath } from 'url'
import { configDefaults, defineConfig } from 'vitest/config'
import { buildDefines } from './build-info.mjs'

export default defineConfig({
  define: buildDefines(),
  resolve: {
    alias: [
      { find: '@peerly/core/react', replacement: fileURLToPath(new URL('./packages/core/src/react.ts', import.meta.url)) },
      { find: '@peerly/core', replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
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
    include: ['src/**/*.test.{ts,tsx}', 'packages/core/src/**/*.test.ts', 'worker/**/*.test.mjs'],
    // pnpm run test:workers runs these in workerd.
    exclude: [...configDefaults.exclude, '**/*.workers.test.*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'packages/core/src/deviceIdentity.ts',
        'packages/core/src/oidcDeviceBinding.ts',
        'packages/core/src/peerIdentityHandshake.ts',
        'packages/core/src/signedControl.ts',
        'packages/core/src/tabSession.ts',
        'src/collab/friendInvite.ts',
      ],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 65 },
    },
  },
})
