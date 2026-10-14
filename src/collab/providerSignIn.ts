import type { DeviceKeyId } from './deviceIdentity'
import { deviceSignInNonce } from '../auth/deviceToken'
import {
  getIdentityProvider,
  type IdentityProvider,
  type IdentityProviderId,
} from './identityProviders'
import { signInWithApple, getAppleRedirectUri } from './appleAuth'
import { signInWithMicrosoft } from './microsoftAuth'
import { signInWithGenericOidc } from './oidcAuth'

export async function signInWithProvider(
  providerId: IdentityProviderId,
  deviceKeyId: DeviceKeyId
): Promise<string> {
  const provider = getIdentityProvider(providerId)
  if (!provider) {
    throw new Error(`Identity provider "${providerId}" is not configured`)
  }
  return signInWithProviderConfig(provider, deviceKeyId)
}

export async function signInWithProviderConfig(
  provider: IdentityProvider,
  deviceKeyId: DeviceKeyId
): Promise<string> {
  // The token's nonce names this device (auth/deviceToken), as Google's does.
  const nonce = deviceSignInNonce(deviceKeyId)
  switch (provider.id) {
    case 'google':
      // Google signs in by redirect (auth/googleRedirect): the page leaves, so there is no token to return here.
      throw new Error('Google signs in by redirect')
    case 'microsoft': {
      // No 'common' fallback: microsoftProvider() refuses to build a config
      // without a pinned tenant, so signing in against a different tenant than
      // the one we verify tokens for would only produce confusing failures.
      const tenant = import.meta.env.VITE_MICROSOFT_TENANT_ID?.trim()
      if (!tenant) throw new Error('VITE_MICROSOFT_TENANT_ID is required for Microsoft sign-in')
      return signInWithMicrosoft(provider.clientId, tenant, nonce)
    }
    case 'apple':
      return signInWithApple(provider.clientId, nonce, getAppleRedirectUri())
    case 'oidc': {
      const issuer = import.meta.env.VITE_OIDC_ISSUER?.trim()
      if (!issuer) throw new Error('VITE_OIDC_ISSUER is required for generic OIDC')
      return signInWithGenericOidc(provider.clientId, issuer, nonce)
    }
    default:
      throw new Error(`Unsupported identity provider: ${provider.id}`)
  }
}