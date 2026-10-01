import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Account } from '../auth/session.ts'
import { WorkspaceSession, type ChannelState, type SessionView } from './session.ts'
import { cachedWorkspaces, loadWorkspaces, subscribeWorkspaces, type Workspace } from './workspaces.ts'

/** The account's workspaces on this device (null while they are read). */
export function useWorkspaces(account: Account): Workspace[] | null {
  const list = useSyncExternalStore(subscribeWorkspaces, () => cachedWorkspaces(account.userId))
  useEffect(() => { void loadWorkspaces(account.userId) }, [account.userId])
  return list
}

/** One session per open workspace: started when a screen opens it, stopped when none shows it. */
const sessions = new Map<string, { session: WorkspaceSession; users: number }>()

export function useWorkspaceSession(account: Account, workspace: Workspace | null, defaultChannelName: string): WorkspaceSession | null {
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const key = workspace ? `${account.userId}\n${workspace.id}` : null
  useEffect(() => {
    if (!workspace || !key) return
    let entry = sessions.get(key)
    if (!entry) {
      entry = { session: new WorkspaceSession(account, workspace, defaultChannelName), users: 0 }
      sessions.set(key, entry)
      void entry.session.start()
    }
    entry.users += 1
    setSession(entry.session)
    return () => {
      const current = sessions.get(key)
      if (!current) return
      current.users -= 1
      // Kept a moment: switching channels or a re-render does not tear the connections down.
      setTimeout(() => {
        if (current.users > 0 || sessions.get(key) !== current) return
        current.session.stop()
        sessions.delete(key)
      }, 2_000)
    }
    // The session follows the workspace by id; a newer list reaches it through the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return session
}

const EMPTY: SessionView = { status: 'connecting', refused: null, history: false, online: [], peers: [], channels: [], name: '', profiles: {}, typing: {} }

export function useSessionView(session: WorkspaceSession | null): SessionView {
  return useSyncExternalStore(listener => session?.subscribe(listener) ?? (() => {}), () => session?.view() ?? EMPTY)
}

export function useChannel(session: WorkspaceSession | null, channelId: string | null): ChannelState {
  useSessionView(session)
  useEffect(() => { if (session && channelId) void session.open(channelId) }, [session, channelId])
  return session && channelId ? session.channelState(channelId) : { messages: [], more: false, loading: true }
}
