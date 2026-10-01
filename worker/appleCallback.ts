/**
 * Sign in with Apple returns by form POST (`response_mode=form_post`, which
 * Apple requires when the address is asked for). This route takes the post
 * and sends the browser on to the sign-in page with the token in the URL
 * fragment, which never reaches a server; the page then checks the state it
 * started with, as for the other providers.
 *
 * The state names where to return (`<random>.<base64url JSON [origin, path]>`).
 * The token goes only to this Worker's origin or one `allowedOrigin` accepts:
 * anything else would hand a sign-in to whoever wrote the state.
 *
 * Self-contained (no app imports), like `signInProviders.ts`.
 */
const MAX_BODY_BYTES = 16 * 1024
const STATE = /^[A-Za-z0-9_-]{16,64}\.([A-Za-z0-9_-]{1,1024})$/
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const ERROR = /^[a-z_]{1,64}$/

const decode = (value: string) => {
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))))
  } catch {
    return null
  }
}

/** Where a sign-in started, from its state; null for a state that names no safe place. */
export function signInReturn(state: string, self: string, allowedOrigin: (origin: string) => boolean): string | null {
  const match = STATE.exec(state)
  const target = match ? decode(match[1]) : null
  if (!Array.isArray(target) || target.length !== 2 || typeof target[0] !== 'string' || typeof target[1] !== 'string') return null
  const [origin, path] = target as [string, string]
  if (origin !== self && !allowedOrigin(origin)) return null
  // A path on that origin, never a protocol-relative or absolute address.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null
  return `${origin}${path}`
}

/** Answers Apple's form post at `path`, or null for any other request. */
export async function handleAppleCallback(request: Request, path: string, allowedOrigin: (origin: string) => boolean): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== path) return null
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } })
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return new Response('Unsupported', { status: 415 })
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return new Response('Too large', { status: 413 })
  const form = new URLSearchParams(text)
  const state = form.get('state') ?? ''
  const destination = signInReturn(state, url.origin, allowedOrigin)
  if (!destination) return new Response('Unknown sign-in', { status: 400 })
  const token = form.get('id_token') ?? ''
  const error = form.get('error') ?? ''
  const fragment = new URLSearchParams({ provider: 'apple', state })
  if (TOKEN.test(token)) fragment.set('id_token', token)
  else fragment.set('error', ERROR.test(error) ? error : 'no_credential')
  return new Response(null, {
    status: 303,
    headers: { location: `${destination}#${fragment}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  })
}
