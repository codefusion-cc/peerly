import { defineConfig, devices } from '@playwright/test'

/**
 * The browser suite, against production's shape: a built app behind the real
 * worker and Durable Objects (server/test-server.mjs), signaling through them,
 * messages and files peer to peer. The Durable Objects suite with server-kept
 * content is playwright.do.config.ts.
 *
 * Serial: every test meets in one control plane, and the fixed E2E accounts
 * (alice, bob) hold at most three sockets and four devices each, so parallel
 * workers would evict each other's tabs.
 */
export default defineConfig({
  testDir: './e2e',
  // The Durable Objects suite has its own config, its own target and its own
  // port. Without this it also runs here, against p2p content, where it cannot
  // pass, and it fails slowly enough to starve the rest of the run.
  testIgnore: /durable-objects\.spec\.ts/,
  // Keep wall-clock failure budget tight: a blocked UI (e.g. consent banner
  // over Send) should fail in ~30–45s, not 90s × 2 retries × many tests.
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // One retry on CI only: genuine regressions fail twice; local runs fail once.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:17273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    permissions: ['camera', 'microphone'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          chromiumSandbox: false,
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--disable-features=WebRtcHideLocalIpsWithMdns',
            '--allow-insecure-localhost',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'node server/test-server.mjs p2p',
    url: 'http://127.0.0.1:17273/.well-known/jwks.json',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})