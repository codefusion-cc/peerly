// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { nonceBindsDevice, LEGACY_NONCE_UNTIL } from '../auth/deviceToken'
import { resetIdentityProviderCache } from './identityProviders'
import { signInWithProvider } from './providerSignIn'

// The popup providers ask for a token whose nonce names the device in the current form, not the legacy bare key id
// that stops being accepted at LEGACY_NONCE_UNTIL. Only the popup (the browser's edge) is faked.

const DEVICE = 'P-256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetIdentityProviderCache()
})

/** The nonce the provider's authorization address carries, read off the popup it opens. */
async function nonceSentBy(providerId: 'microsoft' | 'oidc') {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  void signInWithProvider(providerId, DEVICE).catch(() => {})
  await vi.waitFor(() => expect(open).toHaveBeenCalled())
  return new URL(String(open.mock.calls[0][0])).searchParams.get('nonce')
}

it('Microsoft and generic OIDC sign-ins bind the token to this device in a form accepted after the cutoff', async () => {
  vi.stubEnv('VITE_MICROSOFT_CLIENT_ID', 'ms-client')
  vi.stubEnv('VITE_MICROSOFT_TENANT_ID', '11111111-2222-3333-4444-555555555555')
  vi.stubEnv('VITE_OIDC_CLIENT_ID', 'oidc-client')
  vi.stubEnv('VITE_OIDC_ISSUER', 'https://sso.example')
  resetIdentityProviderCache()
  vi.stubGlobal('fetch', async () => Response.json({ issuer: 'https://sso.example', authorization_endpoint: 'https://sso.example/authorize', jwks_uri: 'https://sso.example/jwks' }))
  for (const provider of ['microsoft', 'oidc'] as const) {
    const nonce = await nonceSentBy(provider)
    expect(nonce, provider).not.toBe(DEVICE)
    expect(nonceBindsDevice(nonce, DEVICE, LEGACY_NONCE_UNTIL + 1), provider).toBe(true)
    vi.restoreAllMocks()
  }
})
