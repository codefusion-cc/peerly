import type { CallState } from '@codefusion-cc/realtime-media/browser'
import { useSyncExternalStore } from 'react'
import type { WorkspaceSession } from '../workspaces/session.ts'

/** The workspace's call as this page sees it, re-rendered as it changes. */
export function useCall(session: WorkspaceSession): CallState {
  return useSyncExternalStore(session.subscribeCall, session.call.getState)
}

/** The accounts in the call now (peer to peer or through the SFU), this one first when it is in. */
export function callMembers(state: CallState, self: string): string[] {
  const ids = new Set<string>()
  if (state.joined) ids.add(self)
  for (const peer of state.peers) ids.add(peer.userId)
  for (const publication of state.publications) ids.add(publication.userId)
  return [...ids]
}

/**
 * Joins the workspace's call with the microphone on (the browser asks for it
 * the first time). The microphone waits for the call's session, which starts
 * once the channel says how the call travels: at most ten seconds.
 */
export function joinCall(session: WorkspaceSession): Promise<void> {
  session.call.join()
  return new Promise(resolve => {
    let finished = false
    const finish = (enable: boolean) => {
      if (finished) return
      finished = true
      unsubscribe()
      clearTimeout(timer)
      if (enable) void session.call.enableMic().catch(() => {}).finally(resolve)
      else resolve()
    }
    const check = () => { const state = session.call.getState(); if (state.ready) finish(true); else if (!state.joined) finish(false) }
    const unsubscribe = session.subscribeCall(check)
    const timer = setTimeout(() => finish(false), 10_000)
    check()
  })
}
