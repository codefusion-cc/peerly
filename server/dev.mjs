import { createProcessRunner } from './spawn-utils.mjs'

const { run } = createProcessRunner()

// The Vite dev server has no Worker, so no Durable Objects to signal through:
// dev uses public Nostr relays. The Worker's own path, signaling and TURN
// included, runs in `pnpm run test:e2e` (server/test-server.mjs).
console.log('\nStarting Peerly — signaling: public Nostr relays\n')

run('vite', 'pnpm', ['exec', 'vite', '--host'], {
  VITE_SIGNALING: 'nostr',
  // The Vite-only dev server has no Durable Object routes. Preview and the
  // Worker E2E harness exercise the default durable content backend.
  VITE_CONTENT_BACKEND: 'p2p',
})
