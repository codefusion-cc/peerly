import { bytesBase64Url, PROOF_PURPOSES, textBase64Url } from '@codefusion-cc/realtime'
import { openControlSocket, testDevice } from '@codefusion-cc/realtime/testing'
import { deviceSignInNonce } from '../../src/auth/deviceToken.ts'

/**
 * Real accounts for Worker tests: an OIDC issuer with a keypair generated per
 * run, ID tokens bound to P-256 device keys, and sign-in through the real
 * enroll and session routes. Nothing here is committed key material, and the
 * generic `oidc` provider it relies on exists only where VITE_OIDC_* is set.
 *
 * The test serves `jwks()` at `jwksUrl` from its own fetch mock, next to
 * whatever other outside service it fakes.
 */

const encodeSegment = value => textBase64Url(JSON.stringify(value))

export async function createTestAccounts({ issuer, clientId, app, origin }) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'e2e', alg: 'RS256', use: 'sig' }
  const jwksUrl = `${issuer}/.well-known/jwks.json`

  /** An RS256 id token for `email`, bound to a device key through `nonce`, issued at `issuedAt` (now by default). */
  async function mintIdToken({ email, nonce, subject, issuedAt = Date.now() }) {
    const header = { alg: 'RS256', typ: 'JWT', kid: 'e2e' }
    const nowSeconds = Math.floor(issuedAt / 1000)
    const claims = {
      iss: issuer,
      aud: clientId,
      sub: subject,
      email,
      email_verified: true,
      nonce,
      iat: nowSeconds,
      exp: nowSeconds + 3_600,
    }
    const body = `${encodeSegment(header)}.${encodeSegment(claims)}`
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body)
    )
    return `${body}.${bytesBase64Url(new Uint8Array(signature))}`
  }

  /** A P-256 device identity, signing requests as `app`'s page does. */
  async function createDevice() {
    const device = await testDevice()
    return { deviceKeyId: device.deviceKeyId, proofHeaders: purpose => device.proofHeaders(purpose, app) }
  }

  /** POST `body` to one of the network routes, signed by `device` for `purpose`. */
  async function signedRequest(path, device, purpose, body) {
    return new Request(new URL(path, origin), {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        ...(await device.proofHeaders(purpose)),
      },
      body: JSON.stringify(body),
    })
  }

  /**
   * Enrols a new device for `email` and establishes a session through
   * `handle` (a Worker's fetch, or the realtime router), as a browser does.
   */
  async function signIn(handle, email, subject) {
    const device = await createDevice()
    const token = await mintIdToken({ email, nonce: deviceSignInNonce(device.deviceKeyId), subject })
    const enrolled = await enroll(handle, device, token)
    if (enrolled.status !== 200) throw new Error(`enroll: HTTP ${enrolled.status}`)
    const { capability } = await enrolled.json()
    const establish = () => signedRequest('/api/network/session', device, PROOF_PURPOSES.session, { capability })
    const session = await handle(await establish())
    if (session.status !== 200) throw new Error(`session: HTTP ${session.status}`)
    const cookie = session.headers.get('set-cookie').split(';')[0]
    return { device, capability, cookie, token, session: await session.json(), establish }
  }

  /** Enrolls `device` with `token` through `handle`, as a browser does. */
  async function enroll(handle, device, token) {
    return handle(await signedRequest('/api/network/enroll', device, PROOF_PURPOSES.enroll, { provider: 'oidc', token }))
  }

  return {
    enroll,
    signedRequest,
    env: { VITE_OIDC_CLIENT_ID: clientId, VITE_OIDC_ISSUER: issuer, OIDC_JWKS_URL: jwksUrl },
    jwksUrl,
    jwks: () => Response.json({ keys: [publicJwk] }),
    mintIdToken,
    createDevice,
    signIn,
  }
}

/**
 * The page's control socket through a Worker's control route (`handle`, its
 * fetch), said hello on, with the close codes it has received so far.
 */
export async function openPageControlSocket(handle, origin, cookie) {
  const route = { fetch: () => handle(new Request(`${origin}/api/realtime/control`, { headers: { origin, upgrade: 'websocket', cookie } })) }
  // The route ignores the identity headers openControlSocket would stamp: the Worker reads the cookie.
  const control = await openControlSocket(route, { uid: '', deviceKeyId: '', sid: '' })
  const closed = []
  control.socket.addEventListener('close', event => closed.push(event.code))
  return { ...control, closed }
}
