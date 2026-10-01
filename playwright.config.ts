import { defineConfig, devices } from '@playwright/test'

/**
 * The browser suite: the e2e build on the real Worker (scripts/e2e-server.mjs),
 * signing in with the loopback test issuer. Each test makes its own people and
 * workspaces, so tests run in parallel without meeting each other.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:17273',
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['clipboard-read', 'clipboard-write', 'camera', 'microphone'],
        launchOptions: {
          chromiumSandbox: false,
          // Two browser contexts on one machine reach each other over loopback, as they would on a LAN;
          // calls use Chromium's fake camera and microphone.
          args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:17273/api/auth/providers',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
