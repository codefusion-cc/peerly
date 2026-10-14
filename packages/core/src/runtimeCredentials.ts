import type { DeviceSigner } from './textChatSigning.js'

export type RuntimeAuthCredential = {
  token: string
  providerId: string
  signer: DeviceSigner
}

let authCredentialProvider: (() => RuntimeAuthCredential | null | Promise<RuntimeAuthCredential | null>) | null = null
const rendezvousCache = new Map<string, string>()

/** Return the currently configured live credential without exposing the provider callback. */
export async function getRuntimeAuthCredential(): Promise<RuntimeAuthCredential | null> {
  return authCredentialProvider ? await authCredentialProvider() : null
}

/** Register the live, device-bound OIDC credential the control session and rendezvous lookups sign with. */
export function configureRuntimeAuthCredentialProvider(
  provider: (() => RuntimeAuthCredential | null | Promise<RuntimeAuthCredential | null>) | null
): void {
  authCredentialProvider = provider
  rendezvousCache.clear()
}

/**
 * Backward-compatible Google-only adapter. New consumers should provide the
 * signer too via `configureRuntimeAuthCredentialProvider`; without it every
 * signed request is rejected.
 */
export function configureRuntimeAuthTokenProvider(
  provider: (() => string | null | Promise<string | null>) | null
): void {
  configureRuntimeAuthCredentialProvider(provider ? async () => {
    const token = await provider()
    if (!token) return null
    return {
      token,
      providerId: 'google',
      signer: {
        publicKeyId: async () => '',
        sign: async () => '',
      },
    }
  } : null)
}

const rendezvousProof = (
  providerId: string,
  deviceKeyId: string,
  timestamp: number,
  nonce: string,
  email: string
): Uint8Array => new TextEncoder().encode([
  'peerly-rendezvous-lookup-v1',
  providerId,
  deviceKeyId,
  String(timestamp),
  nonce,
  email,
].join('\n'))

/** Resolve an email to an opaque, deployment-keyed capability after live OIDC/device authentication. */
export async function lookupRendezvousId(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized || !authCredentialProvider || typeof fetch !== 'function') return null
  const cachedId = rendezvousCache.get(normalized)
  if (cachedId) return cachedId
  try {
    const auth = await authCredentialProvider()
    if (!auth?.token || !auth.providerId) return null
    const deviceKeyId = await auth.signer.publicKeyId()
    const timestamp = Date.now()
    const nonce = crypto.randomUUID()
    const signature = await auth.signer.sign(
      rendezvousProof(auth.providerId, deviceKeyId, timestamp, nonce, normalized)
    )
    const response = await fetch('/api/rendezvous/lookup', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.token}`,
        'content-type': 'application/json',
        'x-peerly-provider': auth.providerId,
        'x-peerly-device-key': deviceKeyId,
        'x-peerly-request-ts': String(timestamp),
        'x-peerly-request-nonce': nonce,
        'x-peerly-request-signature': signature,
      },
      body: JSON.stringify({ email: normalized }),
    })
    if (!response.ok) return null
    const value = await response.json() as { rendezvousId?: unknown }
    if (typeof value.rendezvousId !== 'string' || value.rendezvousId.length < 32) return null
    rendezvousCache.set(normalized, value.rendezvousId)
    return value.rendezvousId
  } catch {
    return null
  }
}

export function clearRendezvousCache(): void {
  rendezvousCache.clear()
}
