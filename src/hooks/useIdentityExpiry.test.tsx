// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEVICE_TOKEN_MAX_AGE_MS } from '@peerly/core/device-token'
import { saveIdCredentials } from '../session'
import { utf8ToBase64Url } from '../utils/base64url'
import { useIdentityExpiry } from './useIdentityExpiry'

// A tab left open for weeks: the banner warns on the token's last day and says it ended after 30 days, although a
// browser timer holds at most 24.8 days. Only time is faked.

const DAY = 24 * 60 * 60_000
const tokenIssuedNow = () => {
  const iat = Math.floor(Date.now() / 1000)
  return `${utf8ToBase64Url(JSON.stringify({ alg: 'RS256' }))}.${utf8ToBase64Url(JSON.stringify({ iat, exp: iat + 3600 }))}.sig`
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())

it('warns on the last day and ends after 30 days in a tab that stays open', async () => {
  saveIdCredentials(tokenIssuedNow(), 'google', 'ada@example.com')
  const { result } = renderHook(() => useIdentityExpiry())
  expect(result.current.phase).toBe('ok')
  await act(() => vi.advanceTimersByTimeAsync(DEVICE_TOKEN_MAX_AGE_MS - DAY + 60_000))
  expect(result.current.phase).toBe('expiring')
  await act(() => vi.advanceTimersByTimeAsync(DAY))
  expect(result.current.phase).toBe('expired')
})

it('reads as expired once the token is found unusable, and as fine again after a new one', async () => {
  saveIdCredentials(tokenIssuedNow(), 'google', 'ada@example.com')
  let answer: 'ok' | 'unusable' = 'ok'
  const checkToken = vi.fn(async () => answer)
  const { result } = renderHook(() => useIdentityExpiry(checkToken))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(result.current.phase).toBe('ok')

  // Google withdrew the key; the person comes back to the tab.
  answer = 'unusable'
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(result.current.phase).toBe('expired')

  // Signed in again: a new token, checked afresh.
  answer = 'ok'
  await act(() => vi.advanceTimersByTimeAsync(1_000))
  saveIdCredentials(tokenIssuedNow(), 'google', 'ada@example.com')
  act(() => result.current.refresh())
  expect(result.current.phase).toBe('ok')
})

it('checks again every six hours in a tab left open', async () => {
  saveIdCredentials(tokenIssuedNow(), 'google', 'ada@example.com')
  const checkToken = vi.fn(async () => 'ok' as const)
  renderHook(() => useIdentityExpiry(checkToken))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(checkToken).toHaveBeenCalledTimes(1)
  await act(() => vi.advanceTimersByTimeAsync(6 * 60 * 60_000))
  expect(checkToken).toHaveBeenCalledTimes(2)
})
