import { testGoogleIssuer, type TestGoogleIssuer } from '@codefusion-cc/google-sign-in/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../../worker/index.mjs'
import { readWranglerConfig } from '../../worker/testing/wranglerConfig.mjs'
import { deviceSignInNonce } from './deviceToken'

// Google sign-in end to end, as far as one process can take it: the page's real redirect code, the package's fake
// Google (its account chooser and keys), and Peerly's real Worker for the callback. Only the page's edges are made
// up: its address and history, its storage, and the network to Google's keys.

const ORIGIN = 'https://peerly.cc'
const DEVICE = 'P-256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'
const OTHER_DEVICE = 'P-256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const DAY = 24 * 60 * 60_000
const workerEnv = readWranglerConfig('wrangler.jsonc').vars

/** A tab: its address, history, both storages and whether the device is online. */
function fakeTab(start: string) {
  let url = new URL(start, ORIGIN)
  const assigned: string[] = []
  const storage = () => {
    const items = new Map<string, string>()
    return {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, String(value)),
      removeItem: (key: string) => void items.delete(key),
      clear: () => items.clear(),
    }
  }
  const tab = {
    assigned,
    online: true,
    sessionStorage: storage(),
    localStorage: storage(),
    get href() { return url.href },
    /** The browser arrives at `href` (a new load of this tab). */
    arrive(href: string) { url = new URL(href, ORIGIN) },
  }
  const location = {
    get origin() { return url.origin },
    get pathname() { return url.pathname },
    get search() { return url.search },
    get hash() { return url.hash },
    get href() { return url.href },
    assign: (href: string) => void assigned.push(href),
  }
  vi.stubGlobal('location', location)
  vi.stubGlobal('history', { state: null, replaceState: (_state: unknown, _title: string, next: string) => { url = new URL(next, url) } })
  vi.stubGlobal('sessionStorage', tab.sessionStorage)
  vi.stubGlobal('localStorage', tab.localStorage)
  vi.stubGlobal('navigator', { get onLine() { return tab.online } })
  return tab
}

let google: TestGoogleIssuer

/** The page's modules, fresh for each test (as a new document gets them). */
async function page() {
  vi.resetModules()
  return import('./googleRedirect')
}

/** Google's chooser answers, its callback page posts to the Worker, and the tab lands where the Worker sends it. */
async function throughGoogle(tab: ReturnType<typeof fakeTab>, options: Parameters<TestGoogleIssuer['authorize']>[1] = {}) {
  const callback = await google.authorize(tab.assigned.at(-1)!, options)
  const form = new URLSearchParams(callback.hash.slice(1))
  const answer = await worker.fetch(new Request(`${ORIGIN}/api/auth/google/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
    body: form,
  }), workerEnv, { waitUntil() {} })
  expect(answer.status).toBe(200)
  tab.arrive((await answer.json()).location)
}

beforeEach(async () => {
  google = await testGoogleIssuer({ clientId: workerEnv.VITE_GOOGLE_CLIENT_ID })
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', workerEnv.VITE_GOOGLE_CLIENT_ID)
  vi.stubGlobal('fetch', google.fetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('signing in', () => {
  it('comes back to where it started, invite link included, and gives the token for this device', async () => {
    const tab = fakeTab('/workspace/abc?view=files#invite=secret-workspace-key')
    const redirect = await page()
    expect(redirect.startGoogleRedirect({ deviceKeyId: DEVICE, purpose: 'sign-in', locale: 'pl' })).toBe(true)

    const toGoogle = new URL(tab.assigned[0])
    // Google sees where to send the browser back to, never where the person was or the invite's secret.
    expect(toGoogle.href).not.toContain('secret-workspace-key')
    expect(toGoogle.href).not.toContain('workspace')
    expect(toGoogle.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`)
    expect(toGoogle.searchParams.get('prompt')).toBe('select_account')
    expect(toGoogle.searchParams.get('hl')).toBe('pl')
    expect(toGoogle.searchParams.get('nonce')?.startsWith(`${DEVICE}.`)).toBe(true)

    await throughGoogle(tab, { claims: { email: 'ada@example.com' } })
    expect(new URL(tab.href).pathname).toBe('/login')

    const back = await page()
    back.takeGoogleReturn()
    expect(tab.href).toBe(`${ORIGIN}/workspace/abc?view=files#invite=secret-workspace-key`)
    expect(back.hasGoogleReturn()).toBe(true)
    const credential = await back.finishGoogleReturn(DEVICE)
    expect(credential?.email).toBe('ada@example.com')
    expect(back.takeGoogleNotice('sign-in')).toBeNull()
    // Taken once: a second look finds nothing.
    expect(await back.finishGoogleReturn(DEVICE)).toBeNull()
  })

  it('says nothing when the person closes Google’s chooser', async () => {
    const tab = fakeTab('/login')
    const redirect = await page()
    redirect.startGoogleRedirect({ deviceKeyId: DEVICE, purpose: 'sign-in' })
    await throughGoogle(tab, { deny: true })
    const back = await page()
    back.takeGoogleReturn()
    expect(await back.finishGoogleReturn(DEVICE)).toBeNull()
    expect(back.takeGoogleNotice('sign-in')).toBeNull()
  })

  it('tells the login screen when Google returns an error', async () => {
    const tab = fakeTab('/login')
    const redirect = await page()
    redirect.startGoogleRedirect({ deviceKeyId: DEVICE, purpose: 'sign-in' })
    await throughGoogle(tab, { deny: 'server_error' })
    const back = await page()
    back.takeGoogleReturn()
    expect(await back.finishGoogleReturn(DEVICE)).toBeNull()
    expect(back.takeGoogleNotice('sign-in')).toEqual({ code: 'failed' })
  })

  it('refuses a return that lands in a tab which did not start it', async () => {
    const tab = fakeTab('/login')
    const redirect = await page()
    redirect.startGoogleRedirect({ deviceKeyId: DEVICE, purpose: 'sign-in' })
    await throughGoogle(tab)
    tab.sessionStorage.clear()
    const back = await page()
    back.takeGoogleReturn()
    expect(await back.finishGoogleReturn(DEVICE)).toBeNull()
    expect(back.takeGoogleNotice('sign-in')).toEqual({ code: 'expired' })
  })

  it('refuses a token this device’s key did not ask for', async () => {
    const tab = fakeTab('/login')
    const redirect = await page()
    redirect.startGoogleRedirect({ deviceKeyId: OTHER_DEVICE, purpose: 'sign-in' })
    await throughGoogle(tab)
    const back = await page()
    back.takeGoogleReturn()
    expect(await back.finishGoogleReturn(DEVICE)).toBeNull()
    expect(back.takeGoogleNotice('sign-in')).toEqual({ code: 'failed' })
  })

  it('refuses a forged token', async () => {
    const tab = fakeTab('/login')
    const redirect = await page()
    redirect.startGoogleRedirect({ deviceKeyId: DEVICE, purpose: 'sign-in' })
    await throughGoogle(tab, { signedWith: 'stranger' })
    const back = await page()
    back.takeGoogleReturn()
    expect(await back.finishGoogleReturn(DEVICE)).toBeNull()
  })

  it('stays, and says so, when the tab keeps no session storage', async () => {
    const tab = fakeTab('/login')
    tab.sessionStorage.setItem = () => { throw new DOMException('blocked', 'SecurityError') }
    const redirect = await page()
    expect(redirect.startGoogleRedirect({ deviceKeyId: DEVICE, purpose: 'sign-in' })).toBe(false)
    expect(tab.assigned).toEqual([])
  })
})

describe('renewing for the same account', () => {
  it('keeps the account: another one chosen at Google is refused and named', async () => {
    const tab = fakeTab('/workspace/abc')
    const redirect = await page()
    redirect.startGoogleRedirect({ deviceKeyId: DEVICE, purpose: 'renew', email: 'ada@example.com' })
    expect(new URL(tab.assigned[0]).searchParams.get('login_hint')).toBe('ada@example.com')
    await throughGoogle(tab, { claims: { email: 'bob@example.com' } })
    const back = await page()
    back.takeGoogleReturn()
    expect(await back.finishGoogleReturn(DEVICE)).toBeNull()
    expect(back.takeGoogleNotice('sign-in')).toBeNull()
    expect(back.takeGoogleNotice('renew')).toEqual({ code: 'other-account', chosen: 'bob@example.com', kept: 'ada@example.com' })
  })

  it('accepts the same account in another case', async () => {
    const tab = fakeTab('/workspace/abc')
    const redirect = await page()
    redirect.startGoogleRedirect({ deviceKeyId: DEVICE, purpose: 'renew', email: 'Ada@Example.com' })
    await throughGoogle(tab, { claims: { email: 'ada@example.com' } })
    const back = await page()
    back.takeGoogleReturn()
    expect((await back.finishGoogleReturn(DEVICE))?.email).toBe('ada@example.com')
  })
})

describe('the quiet refresh', () => {
  const tokenAged = (ms: number) => {
    const iat = Math.floor((Date.now() - ms) / 1000)
    return google.token({ nonce: deviceSignInNonce(DEVICE), iat, exp: iat + 3600 })
  }
  const due = async (redirect: Awaited<ReturnType<typeof page>>, token: string | null, overrides: Partial<{ providerId: string | null; email: string | null }> = {}) =>
    redirect.shouldRefreshGoogle({ token, providerId: 'google', email: 'ada@example.com', deviceKeyId: DEVICE, ...overrides })

  it('leaves a token alone for its first three days, then refreshes it', async () => {
    fakeTab('/')
    const redirect = await page()
    expect(await due(redirect, await tokenAged(2 * DAY))).toBe(false)
    expect(await due(redirect, await tokenAged(redirect.REFRESH_AFTER_MS - 60_000))).toBe(false)
    expect(await due(redirect, await tokenAged(redirect.REFRESH_AFTER_MS + 60_000))).toBe(true)
    expect(await due(redirect, null)).toBe(true)
  })

  it('refreshes a young token whose key Google withdrew', async () => {
    fakeTab('/')
    const redirect = await page()
    const token = await tokenAged(DAY)
    expect(await due(redirect, token)).toBe(false)
    await google.rotate({ keepPrevious: false })
    // A page load after the keys this device read went stale (five minutes) reads them afresh.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 6 * 60_000 })
    try {
      expect(await due(await page(), token)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never for another provider, an account it does not remember, or offline', async () => {
    const tab = fakeTab('/')
    const redirect = await page()
    const old = await tokenAged(10 * DAY)
    expect(await due(redirect, old, { providerId: 'microsoft' })).toBe(false)
    expect(await due(redirect, old, { email: null })).toBe(false)
    tab.online = false
    expect(await due(redirect, old)).toBe(false)
  })

  it('tries at most once a day, recording the try before leaving, without a prompt', async () => {
    const tab = fakeTab('/workspace/abc')
    const redirect = await page()
    const old = await tokenAged(10 * DAY)
    const now = Date.now()
    expect(redirect.refreshGoogleQuietly({ deviceKeyId: DEVICE, email: 'ada@example.com', now })).toBe(true)
    const toGoogle = new URL(tab.assigned[0])
    expect(toGoogle.searchParams.get('prompt')).toBe('none')
    expect(toGoogle.searchParams.get('login_hint')).toBe('ada@example.com')
    // The return never came (the person closed the tab, Google hung): the next loads that day stay put.
    expect(await redirect.shouldRefreshGoogle({ token: old, providerId: 'google', email: 'ada@example.com', deviceKeyId: DEVICE, now: now + redirect.REFRESH_EVERY_MS - 1 })).toBe(false)
    expect(await redirect.shouldRefreshGoogle({ token: old, providerId: 'google', email: 'ada@example.com', deviceKeyId: DEVICE, now: now + redirect.REFRESH_EVERY_MS })).toBe(true)
  })

  it('never without storage to remember the try in', async () => {
    const tab = fakeTab('/')
    tab.localStorage.getItem = () => { throw new DOMException('blocked', 'SecurityError') }
    tab.localStorage.setItem = () => { throw new DOMException('blocked', 'SecurityError') }
    const redirect = await page()
    expect(await due(redirect, null)).toBe(false)
    expect(redirect.refreshGoogleQuietly({ deviceKeyId: DEVICE, email: 'ada@example.com' })).toBe(false)
    expect(tab.assigned).toEqual([])
  })

  it('a failed quiet return says nothing and keeps the old token working', async () => {
    const tab = fakeTab('/workspace/abc')
    const redirect = await page()
    redirect.refreshGoogleQuietly({ deviceKeyId: DEVICE, email: 'ada@example.com' })
    await throughGoogle(tab, { deny: 'login_required' })
    const back = await page()
    back.takeGoogleReturn()
    expect(tab.href).toBe(`${ORIGIN}/workspace/abc`)
    expect(await back.finishGoogleReturn(DEVICE)).toBeNull()
    expect(back.takeGoogleNotice('refresh')).toBeNull()
    expect(back.takeGoogleNotice('sign-in')).toBeNull()
  })

  it('a quiet return with the token stores it', async () => {
    const tab = fakeTab('/')
    const redirect = await page()
    redirect.refreshGoogleQuietly({ deviceKeyId: DEVICE, email: 'ada@example.com' })
    await throughGoogle(tab, { claims: { email: 'ada@example.com' } })
    const back = await page()
    back.takeGoogleReturn()
    expect((await back.finishGoogleReturn(DEVICE))?.email).toBe('ada@example.com')
  })
})
