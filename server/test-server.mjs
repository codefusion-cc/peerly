import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProcessRunner } from './spawn-utils.mjs'

/**
 * The browser E2E target: a production build served by the real worker, with
 * real Durable Objects, real SQLite and real alarms. Only the identity
 * provider and the allowed origin differ from a deployment.
 *
 * `node server/test-server.mjs p2p` is production's shape: signaling through
 * the Durable Objects, messages and files peer to peer. `durable-objects` is
 * preview's, with content kept by the Durable Objects as well. The two are
 * separate builds in separate directories, because the content backend is
 * chosen at build time.
 *
 * See wrangler.e2e.jsonc for why that provider is safe here and nowhere else.
 */
const CONTENT = process.argv[2] === 'durable-objects' ? 'durable-objects' : 'p2p'
const PORT = Number(process.env.TEST_PORT) || (CONTENT === 'p2p' ? 17273 : 17275)
const ORIGIN = `http://127.0.0.1:${PORT}`
const DIST = CONTENT === 'p2p' ? 'dist-e2e' : 'dist-e2e-do'

/** Must match wrangler.e2e.jsonc: the client mints for this audience and issuer. */
const OIDC_CLIENT_ID = 'peerly-e2e-client'
const OIDC_ISSUER = 'https://e2e.peerly.test'

function runToCompletion(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error(`\n[test-server] ${command} ${args.join(' ')} failed`)
    process.exit(result.status ?? 1)
  }
}

// `build:e2e`, not `build`: the shared build runs `guard:bundle`, which must
// stay an unconditional "this artefact may not ship" check rather than one an
// environment variable can talk out of. The E2E path asserts the opposite —
// that the fixtures *are* present — in check-e2e-fixtures.mjs.
runToCompletion('npm', ['run', 'build:e2e'], {
  E2E_DIST: DIST,
  VITE_APP_ID: 'peerly',
  VITE_CONTENT_BACKEND: CONTENT,
  VITE_E2E_AUTH_BYPASS: 'true',
  VITE_OIDC_CLIENT_ID: OIDC_CLIENT_ID,
  VITE_OIDC_ISSUER: OIDC_ISSUER,
  VITE_OIDC_LABEL: 'E2E',
})

// Into `dist-e2e*/`, never `dist/`. Production `wrangler deploy` has no build
// step, so it uploads whatever is already in `dist/` — and a deploy run just
// after the E2E suite would otherwise ship a bundle carrying the test signing
// key. Separate output directories make that impossible rather than unlikely.
runToCompletion('node', ['scripts/emit-e2e-jwks.mjs', DIST], {})

const { run } = createProcessRunner()
const persistenceDirectory = mkdtempSync(join(tmpdir(), 'peerly-e2e-'))
process.on('exit', () => {
  rmSync(persistenceDirectory, { recursive: true, force: true })
})
run('wrangler', 'npx', [
  'wrangler', 'dev',
  '-c', 'wrangler.e2e.jsonc',
  '--assets', DIST,
  '--port', String(PORT),
  '--ip', '127.0.0.1',
  '--var', `CONTENT_BACKEND:${CONTENT}`,
  '--var', `E2E_ALLOWED_ORIGIN:${ORIGIN}`,
  '--var', `OIDC_JWKS_URL:${ORIGIN}/.well-known/jwks.json`,
  // Let the OS pick, so a stale inspector from a previous run cannot wedge
  // the whole suite on a port collision.
  '--inspector-port', '0',
  // A fresh Durable Object namespace per run is essential: the fixed E2E
  // workspace otherwise replays messages written by an earlier invocation,
  // allowing a broken persistence test to pass against stale local state.
  '--persist-to', persistenceDirectory,
])
