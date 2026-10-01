import { describe, expect, it } from 'vitest'
import { handleAppleCallback, signInReturn } from './appleCallback.ts'

const PATH = '/api/auth/apple/callback'
const SELF = 'https://peerly.cc'
const state = (origin: string, path: string, random = 'r'.repeat(22)) =>
  `${random}.${btoa(JSON.stringify([origin, path])).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`
const previews = (origin: string) => /^https:\/\/[a-z0-9-]+\.preview\.peerly\.cc$/.test(origin)
const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }) =>
  handleAppleCallback(new Request(`${SELF}${PATH}`, { method: 'POST', headers, body }), PATH, previews)

describe('signInReturn', () => {
  it('returns to this Worker\'s origin or one it allows, on a path there', () => {
    expect(signInReturn(state(SELF, '/signin'), SELF, previews)).toBe(`${SELF}/signin`)
    expect(signInReturn(state('https://feat-x.preview.peerly.cc', '/signin?next=%2Fw'), SELF, previews)).toBe('https://feat-x.preview.peerly.cc/signin?next=%2Fw')
  })

  it('refuses every other place a token could be sent', () => {
    for (const value of [
      state('https://evil.example', '/signin'), state(SELF, '//evil.example/x'), state(SELF, 'https://evil.example'),
      state(SELF, '/\\evil.example'), state('https://peerly.cc.evil.example', '/'), 'no-dot', `${'r'.repeat(22)}.not-base64-json`,
      state(SELF, '/signin', 'short'), `${'r'.repeat(22)}.${btoa('"just a string"')}`,
    ]) expect(signInReturn(value, SELF, previews)).toBeNull()
  })
})

describe('handleAppleCallback', () => {
  it('sends the browser to the page that started, with the token in the fragment', async () => {
    const response = (await post(new URLSearchParams({ state: state(SELF, '/signin'), id_token: 'aaa.bbb.ccc' }).toString()))!
    expect(response.status).toBe(303)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe(`${SELF}/signin`)
    expect(Object.fromEntries(new URLSearchParams(location.hash.slice(1)))).toEqual({ provider: 'apple', state: state(SELF, '/signin'), id_token: 'aaa.bbb.ccc' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('passes on Apple\'s error, or no_credential for anything that is not a token', async () => {
    const hash = async (fields: Record<string, string>) => new URLSearchParams(new URL((await post(new URLSearchParams(fields).toString()))!.headers.get('location')!).hash.slice(1))
    expect((await hash({ state: state(SELF, '/signin'), error: 'user_cancelled_authorize' })).get('error')).toBe('user_cancelled_authorize')
    expect((await hash({ state: state(SELF, '/signin'), id_token: '<script>' })).get('error')).toBe('no_credential')
    expect((await hash({ state: state(SELF, '/signin'), error: 'Bad Error!' })).get('error')).toBe('no_credential')
  })

  it('answers only its own path, by POST, with a form, not too large, for a known sign-in', async () => {
    expect(await handleAppleCallback(new Request(`${SELF}/elsewhere`, { method: 'POST' }), PATH, previews)).toBeNull()
    expect((await handleAppleCallback(new Request(`${SELF}${PATH}`), PATH, previews))!.status).toBe(405)
    expect((await post('{}', { 'content-type': 'application/json' }))!.status).toBe(415)
    expect((await post(`state=${'x'.repeat(20_000)}`))!.status).toBe(413)
    expect((await post(new URLSearchParams({ state: state('https://evil.example', '/'), id_token: 'a.b.c' }).toString()))!.status).toBe(400)
  })
})
