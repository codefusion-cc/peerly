import { useEffect, useSyncExternalStore } from 'react'
import { APP_ID } from '../config.ts'
import { subscribeRealtimeSignedOut } from '@codefusion-cc/realtime/browser'
import { currentAccount, signOut, subscribeAccount, type Account } from './session.ts'

/** The signed-in account, following sign-in, sign-out (in any tab) and the server ending the session. */
export function useAccount(): Account | null {
  const account = useSyncExternalStore(subscribeAccount, currentAccount)
  useEffect(() => {
    if (!account) return
    // The server no longer takes this device's session (signed out elsewhere, or it expired): sign in again.
    return subscribeRealtimeSignedOut(APP_ID, () => { void signOut() })
  }, [account])
  useEffect(() => {
    // Signing out (or in) in another tab reaches this one.
    const onStorage = (event: StorageEvent) => { if (event.key === 'peerly-account') location.reload() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return account
}
