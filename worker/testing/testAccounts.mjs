/**
 * Real accounts for Worker tests: an OIDC issuer with a keypair generated per
 * run, ID tokens bound to P-256 device keys, and sign-in through the real
 * enroll and session routes. Nothing here is committed key material, and the
 * generic `oidc` provider it relies on exists only where VITE_OIDC_* is set.
 *
 * The test serves `jwks()` at `jwksUrl` from its own fetch mock, next to
 * whatever other outside service it fakes.
 */
import { deviceSignInNonce } from '../../../../src/auth/deviceToken.ts'

const base64Url = bytes =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

const encodeSegment = value => base64Url(new TextEncoder().encode(JSON.stringify(value)))

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
    return `${body}.${base64Url(signature)}`
  }

  /** A P-256 device identity, in the `P-256:<x>:<y>` form the worker expects. */
  async function createDevice() {
    const device = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
    )
    const jwk = await crypto.subtle.exportKey('jwk', device.publicKey)
    const deviceKeyId = `P-256:${jwk.x}:${jwk.y}`
    return {
      deviceKeyId,
      async proofHeaders(purpose) {
        const timestamp = Date.now()
        const nonce = crypto.randomUUID()
        const payload = [purpose, app, deviceKeyId, String(timestamp), nonce, ''].join('\n')
        const signature = await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' }, device.privateKey, new TextEncoder().encode(payload)
        )
        return {
          'x-peerly-device-key': deviceKeyId,
          'x-peerly-request-ts': String(timestamp),
          'x-peerly-request-nonce': nonce,
          'x-peerly-request-signature': base64Url(signature),
        }
      },
    }
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
    const enroll = await handle(await signedRequest('/api/network/enroll', device, 'realtime-enroll-v1',
      { provider: 'oidc', token }))
    if (enroll.status !== 200) throw new Error(`enroll: HTTP ${enroll.status}`)
    const { capability } = await enroll.json()
    const establish = () => signedRequest('/api/network/session', device, 'realtime-session-v1', { capability })
    const session = await handle(await establish())
    if (session.status !== 200) throw new Error(`session: HTTP ${session.status}`)
    const cookie = session.headers.get('set-cookie').split(';')[0]
    return { device, capability, cookie, token, session: await session.json(), establish }
  }

  return {
    env: { VITE_OIDC_CLIENT_ID: clientId, VITE_OIDC_ISSUER: issuer, OIDC_JWKS_URL: jwksUrl },
    jwksUrl,
    jwks: () => Response.json({ keys: [publicJwk] }),
    mintIdToken,
    createDevice,
    signIn,
  }
}
