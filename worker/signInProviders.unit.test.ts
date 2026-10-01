import { afterEach, describe, expect, it, vi } from 'vitest'
import { microsoftIssuer, signInOptions, signInVerifier } from './signInProviders.ts'

const TENANT = '0b1d2c3e-4f50-6172-8394-a5b6c7d8e9f0'
afterEach(() => vi.unstubAllGlobals())

describe('microsoftIssuer', () => {
  it('pins one directory', () => {
    expect(microsoftIssuer(TENANT)).toBe(`https://login.microsoftonline.com/${TENANT}/v2.0`)
    expect(microsoftIssuer(` ${TENANT.toUpperCase()} `)).toBe(`https://login.microsoftonline.com/${TENANT}/v2.0`)
  })

  it('refuses every value that would let other tenants in, and what is not a directory id', () => {
    for (const tenant of ['common', 'COMMON', 'Organizations', 'consumers', '', undefined, 'contoso.onmicrosoft.com', `${TENANT}/x`, '../common']) {
      expect(microsoftIssuer(tenant)).toBeNull()
    }
  })
})

describe('signInOptions', () => {
  it('offers only the providers this deployment configured, correctly', async () => {
    expect(await signInOptions({})).toEqual([])
    expect(await signInOptions({ GOOGLE_CLIENT_ID: ' g ' })).toEqual([{ id: 'google', clientId: 'g' }])
    expect(await signInOptions({ MICROSOFT_CLIENT_ID: 'm', MICROSOFT_TENANT_ID: 'common' })).toEqual([])
    expect(await signInOptions({ MICROSOFT_CLIENT_ID: 'm', MICROSOFT_TENANT_ID: TENANT })).toEqual([{
      id: 'microsoft', clientId: 'm', tenantId: TENANT, authorizationUrl: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
    }])
    expect(await signInOptions({ APPLE_CLIENT_ID: 'cc.peerly.web' })).toEqual([
      { id: 'apple', clientId: 'cc.peerly.web', authorizationUrl: 'https://appleid.apple.com/auth/authorize' },
    ])
  })

  it('offers an OpenID Connect issuer only once its discovery document names it', async () => {
    const issuer = 'https://sso.example.com'
    const fetch = vi.fn(async (url: string) => url === `${issuer}/.well-known/openid-configuration`
      ? Response.json({ issuer, jwks_uri: `${issuer}/keys`, authorization_endpoint: `${issuer}/authorize` })
      : new Response('no', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    expect(await signInOptions({ OIDC_ISSUER: `${issuer}/`, OIDC_CLIENT_ID: 'c', OIDC_LABEL: 'Company' })).toEqual([{
      id: 'oidc', clientId: 'c', issuer, label: 'Company', authorizationUrl: `${issuer}/authorize`,
    }])
    // A plain-http issuer, or one with a query, is never asked.
    expect(await signInOptions({ OIDC_ISSUER: 'http://sso.example.com', OIDC_CLIENT_ID: 'c' })).toEqual([])
    expect(await signInOptions({ OIDC_ISSUER: `${issuer}?x=1`, OIDC_CLIENT_ID: 'c' })).toEqual([])
  })

  it('leaves out an issuer whose document names another issuer', async () => {
    const issuer = 'https://other-sso.example.com'
    vi.stubGlobal('fetch', async () => Response.json({ issuer: 'https://evil.example.com', jwks_uri: 'x', authorization_endpoint: 'y' }))
    expect(await signInOptions({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'c' })).toEqual([])
  })
})

describe('signInVerifier', () => {
  it('has a verifier only for a provider this deployment offers', () => {
    expect(signInVerifier('google', {})).toBeNull()
    expect(signInVerifier('google', { GOOGLE_CLIENT_ID: 'g' })).not.toBeNull()
    expect(signInVerifier('microsoft', { MICROSOFT_CLIENT_ID: 'm', MICROSOFT_TENANT_ID: 'organizations' })).toBeNull()
    expect(signInVerifier('microsoft', { MICROSOFT_CLIENT_ID: 'm', MICROSOFT_TENANT_ID: TENANT })).not.toBeNull()
    expect(signInVerifier('apple', { APPLE_CLIENT_ID: 'a' })).not.toBeNull()
    expect(signInVerifier('oidc', { OIDC_CLIENT_ID: 'c', OIDC_ISSUER: 'not a url' })).toBeNull()
    expect(signInVerifier('github', { GOOGLE_CLIENT_ID: 'g' })).toBeNull()
  })

  it('refuses a token it cannot read, and says the keys are unavailable when the issuer cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    const verifier = signInVerifier('oidc', { OIDC_CLIENT_ID: 'c', OIDC_ISSUER: 'https://down.example.com' })!
    expect(await verifier.verify('not.a.token', 'nonce', Date.now())).toEqual({ ok: false, problem: 'keys-unavailable' })
  })
})
