import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// The Worker in workerd, with the e2e config's bindings (Durable Objects, no
// deployed resources). Each test file gets its own storage.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.e2e.jsonc' },
      miniflare: {
        bindings: {
          NETWORK_SESSION_SECRET: 'test-network-session-secret-0123456789',
          OPAQUE_USER_ID_SECRET: 'test-opaque-user-id-secret-0123456789',
          E2E_ALLOWED_ORIGIN: 'https://peerly.test',
          OIDC_ISSUER: 'https://issuer.peerly.test',
          OIDC_JWKS_URL: 'https://issuer.peerly.test/jwks',
          // TURN counts as configured, so a call may offer relays; nothing here asks Cloudflare for credentials.
          TURN_KEY_ID: 'test-turn-key',
          TURN_KEY_API_TOKEN: 'test-turn-token',
        },
      },
    }),
  ],
  test: {
    include: ['worker/**/*.workers.test.ts'],
  },
})
