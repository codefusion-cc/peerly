import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/deviceIdentity.ts',
        'src/oidcDeviceBinding.ts',
        'src/peerIdentityHandshake.ts',
        'src/signedControl.ts',
        'src/tabSession.ts',
      ],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 65 },
    },
  },
})
