import { defineConfig } from 'vitest/config'
import { buildDefines } from './build-info.mjs'

// The page and the code both sides share, in Node (jsdom where a test asks).
// The Worker's tests run in workerd: vitest.workers.config.ts.
export default defineConfig({
  define: buildDefines(),
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'worker/**/*.unit.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}', 'shared/**/*.ts', 'worker/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', 'src/main.tsx', 'src/auth/e2eKeys.ts'],
    },
  },
})
