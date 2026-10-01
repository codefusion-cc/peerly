/**
 * `npm run dev`: the page from Vite (with hot reload) and its real Worker
 * from `wrangler dev`, with local Durable Objects and SQLite kept in
 * `.wrangler/local-dev`. Nothing here reaches a deployed service or uses a
 * production secret: the two secrets the Worker needs are made for this
 * checkout the first time.
 *
 * Sign-in: Google when `GOOGLE_CLIENT_ID` is set (in the environment or
 * `.env`) and allows this origin; and always the test issuer of the e2e
 * suite, which exists only on loopback. Its keys are a fixture, so anyone
 * can mint its tokens: that is why it is offered only here and in e2e runs,
 * from an origin that is 127.0.0.1 or localhost.
 *
 * Options: `--port 5173` (Vite), `--host 127.0.0.1`, `--no-test-sign-in`.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import ts from 'typescript'
import { createServer, loadEnv } from 'vite'

const { values } = parseArgs({ options: {
  port: { type: 'string', default: '5173' },
  host: { type: 'string', default: '127.0.0.1' },
  'no-test-sign-in': { type: 'boolean', default: false },
} })
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Pick a port between 1024 and 65535')
if (!['localhost', '127.0.0.1'].includes(values.host)) throw new Error('Local development listens on loopback only')
const origin = `http://${values.host}:${port}`
const testSignIn = !values['no-test-sign-in']

const root = process.cwd()
const stateDir = resolve(root, '.wrangler/local-dev')
await mkdir(stateDir, { recursive: true })

// The Worker's secrets for this checkout, made once and kept beside its local state.
const secretsFile = resolve(stateDir, '.dev.vars')
try {
  await readFile(secretsFile)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  await writeFile(secretsFile, ['NETWORK_SESSION_SECRET', 'OPAQUE_USER_ID_SECRET']
    .map(key => `${key}=${randomBytes(32).toString('hex')}`).join('\n'), { mode: 0o600 })
}

const source = ts.readConfigFile(resolve(root, 'wrangler.e2e.jsonc'), ts.sys.readFile)
if (source.error) throw new Error('Cannot read wrangler.e2e.jsonc')
const env = loadEnv('development', root, '')
const googleClientId = process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || ''
const { vars: e2eVars, ...base } = source.config

// Vite serves the page; the Worker answers /api only.
const assetsDir = resolve(stateDir, 'assets')
await mkdir(assetsDir, { recursive: true })
await writeFile(resolve(assetsDir, 'index.html'), 'Peerly’s local API. Open the Vite address instead.')
const configPath = resolve(stateDir, 'wrangler.jsonc')
await writeFile(configPath, JSON.stringify({
  ...base,
  name: 'peerly-local',
  main: resolve(root, 'worker/index.ts'),
  assets: { binding: 'ASSETS', directory: assetsDir, run_worker_first: true },
  vars: {
    APP_ID: 'peerly',
    APP_ENV: 'development',
    E2E_ALLOWED_ORIGIN: origin,
    ...(googleClientId ? { GOOGLE_CLIENT_ID: googleClientId } : {}),
    ...(testSignIn ? {
      OIDC_CLIENT_ID: e2eVars.OIDC_CLIENT_ID,
      OIDC_ISSUER: origin,
      OIDC_JWKS_URL: `${origin}/.well-known/jwks.json`,
      OIDC_LABEL: 'Test',
    } : {}),
  },
}, null, 2))

const freePort = () => new Promise((done, fail) => {
  const server = createNetServer()
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => {
    const { port: free } = server.address()
    server.close(() => done(free))
  })
})

const apiPort = await freePort()
const worker = spawn(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
  'dev', '--local', '--config', configPath, '--env-file', secretsFile, '--port', String(apiPort),
  '--ip', '127.0.0.1', '--inspector-port', '0', '--persist-to', resolve(stateDir, 'state'),
], { stdio: 'inherit' })

let vite
let stopping = false
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  worker.kill('SIGTERM')
  await vite?.close()
  process.exit(code)
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
worker.on('exit', code => void stop(code ?? 1))
worker.on('error', error => { console.error(error); void stop(1) })

/** The test issuer's discovery document and keys, at the page's origin (only in this dev server). */
const testIssuer = {
  name: 'peerly-test-issuer',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!testSignIn) return next()
      if (request.url === '/.well-known/jwks.json') {
        response.setHeader('content-type', 'application/json')
        response.end(await readFile(resolve(root, 'e2e/fixtures/oidcJwks.json')))
        return
      }
      if (request.url === '/.well-known/openid-configuration') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ issuer: origin, jwks_uri: `${origin}/.well-known/jwks.json`, authorization_endpoint: `${origin}/signin` }))
        return
      }
      next()
    })
  },
}

try {
  const target = `http://127.0.0.1:${apiPort}`
  let ready = false
  for (let attempt = 0; attempt < 120 && !ready; attempt++) {
    try {
      const response = await fetch(`${target}/api/auth/providers`, { signal: AbortSignal.timeout(1000) })
      ready = response.ok
    } catch {
      // The Worker is still starting.
    }
    if (!ready) await new Promise(done => setTimeout(done, 250))
  }
  if (!ready) throw new Error('The local Worker did not start')
  process.env.VITE_APP_ID = 'peerly'
  if (testSignIn) process.env.VITE_E2E_AUTH = 'true'
  vite = await createServer({
    plugins: [testIssuer],
    server: { host: values.host, port, strictPort: true, proxy: { '/api': { target, ws: true } } },
  })
  await vite.listen()
  vite.printUrls()
} catch (error) {
  console.error(error)
  await stop(1)
}
