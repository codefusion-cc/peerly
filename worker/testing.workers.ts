// How the Worker's workerd tests sign people in: through the real routes and
// the `oidc` provider, with the e2e issuer's key (its key set is served to the
// Worker by a stubbed fetch).
import { env, SELF } from 'cloudflare:test'
import { vi } from 'vitest'
import { createAccountKeys } from '@codefusion-cc/realtime/browser'
import { openControlSocket, PROOF_PURPOSES, testDevice, type TestDevice } from '@codefusion-cc/realtime/testing'
import { verifyCapability } from '@codefusion-cc/realtime'
import { APP_ID } from '../shared/app.ts'
import { signMemberList } from '../shared/memberList.ts'
import { mintE2eToken } from '../src/auth/e2eKeys.ts'
import jwks from '../e2e/fixtures/oidcJwks.json'

export const ORIGIN = 'https://peerly.test'
export const ISSUER = { issuer: 'https://issuer.peerly.test', clientId: 'peerly-e2e-client' }
export const keys = createAccountKeys(APP_ID)
const json = { 'content-type': 'application/json', origin: ORIGIN }

/** Serves the e2e issuer's key set to the Worker; anything else goes out as usual. */
export function serveIssuerKeys() {
  const real = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === 'https://issuer.peerly.test/jwks') return Response.json(jwks)
    return real(input, init)
  })
}

export type Person = {
  email: string
  device: TestDevice
  cookie: string
  uid: string
  sid: string
  userId: string
}

/** A person signed in through the routes with a verified email, as a browser does it. */
export async function signIn(email = `${crypto.randomUUID().slice(0, 8)}@example.com`): Promise<Person> {
  const device = await testDevice()
  const token = await mintE2eToken(ISSUER, email, device.deviceKeyId)
  const enrolled = await SELF.fetch(`${ORIGIN}/api/network/enroll`, {
    method: 'POST', headers: { ...json, ...await device.proofHeaders(PROOF_PURPOSES.enroll, APP_ID) },
    body: JSON.stringify({ provider: 'oidc', token }),
  })
  if (enrolled.status !== 200) throw new Error(`enroll: ${enrolled.status} ${await enrolled.text()}`)
  const { capability } = await enrolled.json() as { capability: string }
  const session = await SELF.fetch(`${ORIGIN}/api/network/session`, {
    method: 'POST', headers: { ...json, ...await device.proofHeaders(PROOF_PURPOSES.session, APP_ID) },
    body: JSON.stringify({ capability }),
  })
  if (session.status !== 200) throw new Error(`session: ${session.status}`)
  const claims = await verifyCapability(env.NETWORK_SESSION_SECRET, capability, { app: APP_ID, now: Date.now() })
  return {
    email, device, cookie: session.headers.get('set-cookie')!.split(';')[0],
    uid: claims!.uid, sid: claims!.sid, userId: claims!.user as string,
  }
}

/** The person's account gateway, and a control socket to it. */
export async function control(person: Person) {
  const gateway = env.USER_GATEWAYS.getByName(`${APP_ID}:${person.uid}`)
  const socket = await openControlSocket(gateway as never, { uid: person.uid, deviceKeyId: person.device.deviceKeyId, sid: person.sid, publicUserId: person.userId })
  return { gateway, socket }
}

/** Makes the person's account keys, as their first linked device does; answers the secrets. */
export async function accountKeys(person: Person) {
  const { socket } = await control(person)
  const secrets = await keys.generateSecrets()
  const box = await keys.generateBoxKey()
  const cert = await keys.issueCertificate(secrets, { userId: person.userId, deviceKeyId: person.device.deviceKeyId, boxKey: box.publicKey, issuedAt: Date.now() })
  const answer = await socket.command('devices.init', { name: 'Laptop', cert, bundle: await keys.sealBundle(secrets, box.publicKey), vaultVersion: secrets.vaultVersion })
  socket.close()
  if (answer.payload.result?.ok !== true) throw new Error(`devices.init: ${JSON.stringify(answer.payload)}`)
  return secrets
}

/** A fresh workspace capability, as a page derives one from a new workspace's secret. */
export const capability = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** The owner's signed list of these people. */
export async function memberList(owner: Person, secrets: Awaited<ReturnType<typeof accountKeys>>, scope: string, people: Array<Person | string>, previous?: number) {
  return signMemberList(keys, secrets as never, {
    scope, ownerUserId: owner.userId, emails: people.map(person => typeof person === 'string' ? person : person.email), previous,
  })
}

/** Asks the person's gateway to let them into a workspace with this list. */
export async function authorize(person: Person, scope: string, list: unknown) {
  const { socket } = await control(person)
  const answer = await socket.command('workspace.authorize', { capability: scope, list })
  socket.close()
  return answer
}

/** A WebSocket upgrade to a workspace's channel with the person's cookie. */
export const join = (person: Person, routeId: string) =>
  SELF.fetch(`${ORIGIN}/api/workspaces/${routeId}`, { headers: { upgrade: 'websocket', origin: ORIGIN, cookie: person.cookie } })
