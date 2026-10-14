import { useCallback, useEffect, useState } from 'react'
import {
  identityExpiryPhase,
  msUntilPhaseChange,
  type IdentityExpiryPhase,
} from '../collab/identityExpiry'
import { idTokenUsableUntil, loadIdToken, loadIdentityProvider } from '../session'
import { checkOwnGoogleToken } from '../auth/googleRedirect'
import { DeviceIdentity } from '../collab/deviceIdentity'
import { isE2eAuthBypass } from '../collab/e2eAuth'

/** How often an open tab checks its own Google token against Google's keys, besides when the person comes back. */
export const OWN_TOKEN_CHECK_MS = 6 * 60 * 60_000

type TokenCheck = (token: string) => Promise<'ok' | 'unusable' | 'unknown'>

/** This device's Google token as its peers check it (auth/googleRedirect); other providers are not checked. */
const checkStoredToken: TokenCheck = async token => {
  if (loadIdentityProvider() !== 'google' || isE2eAuthBypass()) return 'unknown'
  return checkOwnGoogleToken({ token, deviceKeyId: await new DeviceIdentity().publicKeyId() })
}

/**
 * Tracks the signed-in token's lifetime and re-evaluates exactly at the two
 * moments the answer can change (warning boundary, expiry). A token that ends
 * early (Google withdrew the key it is signed with) is found by checking it as
 * peers do, when the tab opens, when the person comes back and every
 * `OWN_TOKEN_CHECK_MS`; it reads as expired. Call `refresh()` after a
 * re-authentication stores a new token.
 */
export function useIdentityExpiry(checkToken: TokenCheck = checkStoredToken): {
  phase: IdentityExpiryPhase
  expiresAtMs: number | null
  refresh: () => void
} {
  // null = NO token (⇒ 'expired': sessions outlive tokens, re-auth needed).
  // Infinity = token present but exp unreadable (opaque issuer) — never nag;
  // the peer handshake still enforces the real expiry.
  const readExpiry = () => {
    const token = loadIdToken()
    if (!token) return null
    return idTokenUsableUntil(token) ?? Infinity
  }
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(readExpiry)
  const [phase, setPhase] = useState<IdentityExpiryPhase>(() =>
    identityExpiryPhase(expiresAtMs, Date.now())
  )

  // Bumped when a timer fires: one that fired before its boundary (a browser
  // timer holds at most 24.8 days) schedules the rest of the wait.
  const [wakeups, setWakeups] = useState(0)

  const refresh = useCallback(() => {
    setExpiresAtMs(readExpiry())
  }, [])

  useEffect(() => {
    setPhase(identityExpiryPhase(expiresAtMs, Date.now()))
    const delay = msUntilPhaseChange(expiresAtMs, Date.now())
    if (delay === null) return
    const timer = window.setTimeout(() => setWakeups(count => count + 1), delay)
    return () => window.clearTimeout(timer)
  }, [expiresAtMs, wakeups])

  const [unusable, setUnusable] = useState<string | null>(null)
  useEffect(() => {
    let stopped = false
    const check = () => {
      const token = loadIdToken()
      if (!token || document.visibilityState !== 'visible') return
      void checkToken(token).then(result => {
        if (!stopped && result === 'unusable') setUnusable(token)
      }, () => {})
    }
    check()
    const timer = window.setInterval(check, OWN_TOKEN_CHECK_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [checkToken, expiresAtMs])

  const ended = unusable !== null && unusable === loadIdToken()
  return { phase: ended ? 'expired' : phase, expiresAtMs, refresh }
}
