/**
 * Signing in on an end-to-end test build: the test issuer's token is minted in
 * the page, for whichever address the test types, and goes through the same
 * routes as a real one (the Worker verifies it against the test issuer's keys).
 *
 * The guard is an inline `import.meta.env` comparison so the bundler folds it
 * and drops `./e2eKeys.ts` (a real private key) from every other build;
 * `npm run guard:bundle` fails a build that still carries it.
 */
import type { ProviderId } from './session.ts'

export async function e2eToken(email: string, nonce: string): Promise<{ credential: string; provider: ProviderId }> {
  if (import.meta.env.VITE_E2E_AUTH !== 'true') throw new Error('Not an end-to-end test build')
  const { mintE2eToken } = await import('./e2eKeys.ts')
  return { credential: await mintE2eToken({ issuer: location.origin, clientId: 'peerly-e2e-client' }, email, nonce), provider: 'oidc' }
}
