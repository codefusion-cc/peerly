import { useEffect, useState } from 'react'
import { sendRealtimeCommand, subscribeRealtimeEvent } from '@codefusion-cc/realtime/browser'
import { APP_ID } from '../config.ts'
import { PREMIUM } from '../../shared/app.ts'

export type Membership = { plan: string | null; until: number | null; grantedAt: number | null }

/** The account's plan, as the server says (and when staff change it, at once); null until it answered. */
export function useMembership(userId: string): Membership | null {
  const [membership, setMembership] = useState<Membership | null>(null)
  useEffect(() => {
    let active = true
    const read = () => sendRealtimeCommand<Membership>(APP_ID, 'membership.read', {})
      .then(value => { if (active) setMembership(value) }, () => {})
    void read()
    const stop = subscribeRealtimeEvent(APP_ID, 'account.membership', event => {
      if (active) setMembership((event as CustomEvent<Membership>).detail)
    })
    return () => { active = false; stop() }
  }, [userId])
  return membership
}

export const isPremium = (membership: Membership | null) => membership?.plan === PREMIUM
