/**
 * The end-to-end target: the e2e build served by the real Worker
 * (`wrangler dev --local`), with real Durable Objects, SQLite and alarms, and
 * the loopback-only test issuer of wrangler.e2e.jsonc.
 *
 * The build carries a private key anyone can mint tokens with, and serves its
 * public half at /.well-known/jwks.json: it is never deployable, which is why
 * it is `build:e2e` (checked by check-e2e-fixtures.mjs) and not `build`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const PORT = Number(process.env.E2E_PORT) || 17273
const ORIGIN = `http://127.0.0.1:${PORT}`
const root = process.cwd()

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.status !== 0) {
    console.error(`[e2e-server] ${command} ${args.join(' ')} failed`)
    process.exit(result.status ?? 1)
  }
}

if (!process.env.E2E_SKIP_BUILD) run('npm', ['run', 'build:e2e'])
run('node', ['scripts/emit-e2e-jwks.mjs', 'dist-e2e'])

// Fresh state and secrets for each run, outside the checkout.
const stateDir = await mkdtemp(join(tmpdir(), 'peerly-e2e-'))
const secretsFile = join(stateDir, '.dev.vars')
await writeFile(secretsFile, ['NETWORK_SESSION_SECRET', 'OPAQUE_USER_ID_SECRET']
  .map(key => `${key}=${randomBytes(32).toString('hex')}`).join('\n'), { mode: 0o600 })

const source = ts.readConfigFile(resolve(root, 'wrangler.e2e.jsonc'), ts.sys.readFile)
if (source.error) throw new Error('Cannot read wrangler.e2e.jsonc')
const configPath = join(stateDir, 'wrangler.jsonc')
await writeFile(configPath, JSON.stringify({
  ...source.config,
  main: resolve(root, 'worker/index.ts'),
  assets: { ...source.config.assets, directory: resolve(root, 'dist-e2e') },
  vars: {
    ...source.config.vars,
    E2E_ALLOWED_ORIGIN: ORIGIN,
    OIDC_ISSUER: ORIGIN,
    OIDC_JWKS_URL: `${ORIGIN}/.well-known/jwks.json`,
  },
}, null, 2))

const worker = spawn(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
  'dev', '--local', '--config', configPath, '--env-file', secretsFile, '--port', String(PORT),
  '--ip', '127.0.0.1', '--inspector-port', '0', '--persist-to', join(stateDir, 'state'), '--show-interactive-dev-session=false',
], { stdio: 'inherit' })
const stop = () => { worker.kill('SIGTERM') }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
worker.on('exit', code => process.exit(code ?? 0))
