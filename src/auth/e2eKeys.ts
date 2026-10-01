/**
 * The end-to-end tests' identity provider key. NEVER import this module
 * statically: only through the guarded dynamic import in `e2eAuth.ts`.
 *
 * It is a real RSA private key that mints tokens the e2e Worker accepts (its
 * public half is served as the e2e issuer's key set). It is public in git, so
 * it is safe only while it cannot reach a deployable bundle: the guard is an
 * inline `import.meta.env` comparison the bundler folds, which drops this
 * chunk, and `npm run guard:bundle` fails a build that still carries it.
 *
 * Fixed rather than generated: every browser of a run must agree with the
 * Worker on one key.
 */
import { bytesToBase64Url, utf8ToBase64Url } from '@codefusion-cc/realtime/browser'
import E2E_JWKS from '../../e2e/fixtures/oidcJwks.json'

const PUBLIC_JWK = E2E_JWKS.keys[0] as JsonWebKey & { kid: string; n: string }

const PRIVATE_JWK: JsonWebKey = {
  key_ops: ['sign'],
  ext: true,
  alg: 'RS256',
  kty: 'RSA',
  n: PUBLIC_JWK.n,
  e: 'AQAB',
  d: 'NqIymRvy3qsy_VGDrWFbp70XvKmt6c4Mc9r8aT1BoNtor-KlsLF5FEY3WXS3-PWA1-H_rt8V5nCfVZL5wU5Hl-b2GVNmTcGFp0gwmef3Gyx_s4w2E8gTTHEafJ1MOW7nO3Wq_CZA87dUlyoN7Lag_oQlp873L3SbzW1PPnYuW7W5V1eKNtK4xBEb8n0X4RdgWyhAMb_pw0YvsrAJ5PeFrV7rb9Q3kNN-gNOMl8-GARzpsFkPTr8AmXIHOyDCMcFJnKP-gxRw-tvraZ0fwA8q-ube7eBIsv-EdbIST9udBpSgNGlRh_HGzkjmwY-Ii1tqdgZ8mwKu7J1MCfwBoXkigQ',
  p: '8p03H2OFkL4sVSwxfbQ_3LWa7QO1f9uJPD4k0sXwEDRny_i9M6EePEEvdc81CLRbdU0CzKSZ7q5v177gIxzxJU7mpwJOT3hfNDKd48gQ97WbJRZ0fKWYI-BUm345YG7BU6Kz5NPkLWLFwp8yrYKypAAmKv9hgO64As4tVAvNlYk',
  q: '2iIpTfT6JSQjS71O2_aFH03h7js9Xtaq4vAnPG2_JX_0YpIqqFA81EINNUyJaFpY1I-k0oW6fCA8pBxIy9RHm6N5UotQsc-LQEtRPylOrLRmqqJYKlgL3DWFSYXEflcBBxLuk3YYdTx3dQ-tt1zydt8FxAJyp3rqFmyZFf9zi8M',
  dp: 'qI6JqYkfVryJWHNnvwnoBJM3m8uj4bzIz83tD3LtopSGOLQL3z7lHr-7FYJsOiv0Dr7-XudM-wK-OYondr243E7A-O8lMRlUK5OvFn39K9xEebPsIl16IhLNNWqwukq4jj7P9P8x3EZvVxP7xYi0TDS-T8k2GLnBplFQNMAuiOE',
  dq: 'ISaf8GESwyJC2vfiTDui76b-dx45rXgicGrfC6gCLMjNc02TfhDzra58I2WGXH2ekm9iNTxtov-jN620woV4fIbToV_a26sXFqZbqqW0dzrTf4s8qvLGmqjnoMzbl_fRCCowZ-jCvs55uSiw1fUiRD6QucFFe36KpO3MNjOkc9E',
  qi: 'wwudhZnm-j5kAnEN6qHlNHPC-xuZgG6u_t5IqH7-hN5egmOY_knr97wik8w0wU0DTGZ-ZTsHGDqCrGUqeST-xJlQotFeaa81ebQCj-hagl8ODAbpJYXMe4nKu0rlL-ElPRjRobSbHfXVyG6u8FuXywJrXAed-8shAfv5ZCnzaJ0',
}

let signingKey: Promise<CryptoKey> | null = null

/** An ID token from the e2e issuer for this email, bound to the device key (the nonce). */
export async function mintE2eToken(target: { issuer: string; clientId: string }, email: string, nonce: string, name = email.split('@')[0]): Promise<string> {
  signingKey ??= crypto.subtle.importKey('jwk', PRIVATE_JWK, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT', kid: PUBLIC_JWK.kid }
  const claims = { iss: target.issuer, aud: target.clientId, sub: email, email, email_verified: true, name, nonce, iat: now, exp: now + 3600 }
  const input = `${utf8ToBase64Url(JSON.stringify(header))}.${utf8ToBase64Url(JSON.stringify(claims))}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey, new TextEncoder().encode(input))
  return `${input}.${bytesToBase64Url(new Uint8Array(signature))}`
}
