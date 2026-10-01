/**
 * The workspaces this account is in, as this device keeps them.
 *
 * A workspace is its secret (random, never sent to the server: it derives the
 * content key and the channel capability), its owner's signed member list,
 * and the name its owner gave it. An invite link carries all three in the URL
 * fragment, which no server sees.
 */
import { createKvStore, deriveChannelCapability, sendRealtimeCommand } from '@codefusion-cc/realtime/browser'
import { APP_ID } from '../config.ts'
import { LIMITS } from '../../shared/app.ts'
import { newerMemberList, normalizeEmail, parseMemberList, signMemberList, verifyMemberList, type MemberList } from '../../shared/memberList.ts'
import { accountKeys, accountSecrets } from '../account/devices.ts'
import type { Account } from '../auth/session.ts'

export type Workspace = {
  /** This device's id for it (in its URLs); not the secret, and not shared. */
  id: string
  /** 32 random bytes, base64url: the content key's and the capability's source. */
  secret: string
  name: string
  /** The owner's newest list this device verified. */
  list: MemberList
  joinedAt: number
  lastOpenedAt: number
  /** Made on this device and not yet given its first channel and name (the session does that once). */
  setup?: boolean
}

/** What an invite link carries. */
export type Invite = { v: 2; secret: string; name: string; list: MemberList }

const SECRET = /^[A-Za-z0-9_-]{43}$/
const MAX_WORKSPACES = 100
const store = createKvStore<Workspace[]>(`${APP_ID}-workspaces`, 'workspaces')

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const randomId = (bytes: number) => base64Url(crypto.getRandomValues(new Uint8Array(bytes)))

/** The name as kept: trimmed, single spaces, at most the limit; null when nothing is left. */
export function workspaceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ').slice(0, LIMITS.workspaceName)
  return name || null
}

/** The capability the server knows a workspace by: a digest of its secret, never the secret. */
export const capabilityOf = (workspace: Pick<Workspace, 'secret'>) => deriveChannelCapability(workspace.secret, 'workspace', APP_ID)

// ---- the account's list, shared by every component -------------------------------------------

const cache = new Map<string, Workspace[]>()
const listeners = new Set<() => void>()
const loading = new Map<string, Promise<Workspace[]>>()

function publish(userId: string, workspaces: Workspace[]) {
  cache.set(userId, workspaces)
  for (const listener of listeners) listener()
}

/** The account's workspaces, newest opened first; read from IndexedDB once. */
export function loadWorkspaces(userId: string): Promise<Workspace[]> {
  const cached = cache.get(userId)
  if (cached) return Promise.resolve(cached)
  let read = loading.get(userId)
  if (!read) {
    read = store.get(userId).then(value => {
      const workspaces = Array.isArray(value) ? value.filter(item => SECRET.test(item?.secret) && parseMemberList(item.list)) : []
      publish(userId, workspaces)
      return workspaces
    }).finally(() => loading.delete(userId))
    loading.set(userId, read)
  }
  return read
}

export const cachedWorkspaces = (userId: string) => cache.get(userId) ?? null
export function subscribeWorkspaces(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Changes the account's list in one place, so two edits never overwrite each other. */
let writing = Promise.resolve()
function update(userId: string, change: (workspaces: Workspace[]) => Workspace[]): Promise<Workspace[]> {
  const next = writing.then(async () => {
    const current = await loadWorkspaces(userId)
    const changed = change(current).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    await store.set(userId, changed)
    publish(userId, changed)
    return changed
  })
  writing = next.then(() => undefined, () => undefined)
  return next
}

// ---- entering a workspace ----------------------------------------------------------------------

/** Installs the list with the server (the gateway checks it) and answers the channel's route and whether it keeps history. */
export async function authorizeWorkspace(workspace: Pick<Workspace, 'secret' | 'list'>): Promise<{ routeId: string; history: boolean }> {
  return sendRealtimeCommand(APP_ID, 'workspace.authorize', { capability: await capabilityOf(workspace), list: workspace.list })
}

/** Why a workspace could not be made, joined or changed. */
export class WorkspaceError extends Error {
  readonly reason: 'not-linked' | 'invalid' | 'not-listed' | 'not-owner' | 'too-many'
  constructor(reason: WorkspaceError['reason']) {
    super(`workspace ${reason}`)
    this.reason = reason
  }
}

/**
 * A new workspace owned by this account: its secret made here, its list
 * (this account and `emails`) signed with the account key, and the server
 * told before anyone is invited.
 */
export async function createWorkspace(account: Account, name: string, emails: string[]): Promise<Workspace> {
  const cleanName = workspaceName(name)
  if (!cleanName) throw new WorkspaceError('invalid')
  const secrets = await accountSecrets(account.userId)
  if (!secrets) throw new WorkspaceError('not-linked')
  const existing = await loadWorkspaces(account.userId)
  if (existing.length >= MAX_WORKSPACES) throw new WorkspaceError('too-many')
  const secret = randomId(32)
  const list = await signMemberList(accountKeys, secrets, {
    scope: await capabilityOf({ secret }), ownerUserId: account.userId, emails: [account.email, ...emails],
  }).catch(() => { throw new WorkspaceError('invalid') })
  await authorizeWorkspace({ secret, list })
  const workspace: Workspace = { id: randomId(12), secret, name: cleanName, list, joinedAt: Date.now(), lastOpenedAt: Date.now(), setup: true }
  await update(account.userId, workspaces => [workspace, ...workspaces])
  return workspace
}

/** The workspace got its first channel and name: never again from this device. */
export const setupDone = (userId: string, workspaceId: string) =>
  update(userId, items => items.map(item => item.id === workspaceId ? { ...item, setup: false } : item))

/** A newer list from the owner (changing who is in); only an owner's linked device can sign one. */
export async function setMembers(account: Account, workspace: Workspace, emails: string[]): Promise<Workspace> {
  const secrets = await accountSecrets(account.userId)
  if (!secrets || secrets.accountKeyId !== workspace.list.ownerKeyId) throw new WorkspaceError('not-owner')
  const list = await signMemberList(accountKeys, secrets, {
    scope: workspace.list.scope, ownerUserId: workspace.list.ownerUserId, emails: [account.email, ...emails], previous: workspace.list.revision,
  }).catch(() => { throw new WorkspaceError('invalid') })
  await authorizeWorkspace({ secret: workspace.secret, list })
  return replaceList(account.userId, workspace.id, list)
}

/** Keeps a newer verified list this device received (from the channel, or a member). Ignores older ones. */
export async function receiveList(userId: string, workspaceId: string, value: unknown): Promise<Workspace | null> {
  const list = parseMemberList(value)
  const workspace = (await loadWorkspaces(userId)).find(item => item.id === workspaceId)
  if (!list || !workspace || list.scope !== workspace.list.scope || list.ownerKeyId !== workspace.list.ownerKeyId ||
    !await verifyMemberList(accountKeys, list) || newerMemberList(workspace.list, list) !== list) return null
  return replaceList(userId, workspaceId, list)
}

async function replaceList(userId: string, workspaceId: string, list: MemberList): Promise<Workspace> {
  const workspaces = await update(userId, items => items.map(item => item.id === workspaceId ? { ...item, list } : item))
  return workspaces.find(item => item.id === workspaceId)!
}

export const isOwner = (account: Pick<Account, 'userId'>, workspace: Workspace) => workspace.list.ownerUserId === account.userId
export const isListed = (account: Pick<Account, 'email'>, list: MemberList) => list.emails.includes(normalizeEmail(account.email) ?? '')

/** Remembers that the person opened it now: the list shows the latest first. */
export const touchWorkspace = (userId: string, workspaceId: string) =>
  update(userId, items => items.map(item => item.id === workspaceId ? { ...item, lastOpenedAt: Date.now() } : item))

export const renameWorkspace = (userId: string, workspaceId: string, name: string) => {
  const clean = workspaceName(name)
  return clean ? update(userId, items => items.map(item => item.id === workspaceId ? { ...item, name: clean } : item)) : Promise.resolve(null)
}

/** Forgets the workspace on this device. Its content here goes with it (`forgetContent`). */
export const leaveWorkspace = (userId: string, workspaceId: string) => update(userId, items => items.filter(item => item.id !== workspaceId))

// ---- invites -----------------------------------------------------------------------------------

/** The link that lets a listed person in: everything in the fragment, which no server sees. */
export function inviteLink(workspace: Workspace, origin = location.origin): string {
  const invite: Invite = { v: 2, secret: workspace.secret, name: workspace.name, list: workspace.list }
  return `${origin}/join#invite=${base64Url(new TextEncoder().encode(JSON.stringify(invite)))}`
}

/** The invite a fragment carries, in shape (not yet verified); null for anything else. */
export function readInvite(hash: string): Invite | null {
  const match = /^#?invite=([A-Za-z0-9_-]{16,16384})$/.exec(hash)
  if (!match) return null
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(match[1].replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)))
    const value = JSON.parse(text) as Partial<Invite>
    const list = parseMemberList(value.list)
    const name = workspaceName(value.name)
    if (value.v !== 2 || typeof value.secret !== 'string' || !SECRET.test(value.secret) || !list || !name) return null
    return { v: 2, secret: value.secret, name, list }
  } catch {
    return null
  }
}

/**
 * Joins with an invite: the list must be the owner's, for this workspace's
 * secret, and name this account's address. Joining again keeps the newer list.
 */
export async function joinWorkspace(account: Account, invite: Invite): Promise<Workspace> {
  if (invite.list.scope !== await capabilityOf(invite) || !await verifyMemberList(accountKeys, invite.list)) throw new WorkspaceError('invalid')
  if (!isListed(account, invite.list)) throw new WorkspaceError('not-listed')
  const existing = (await loadWorkspaces(account.userId)).find(item => item.secret === invite.secret)
  if (existing) {
    await receiveList(account.userId, existing.id, invite.list)
    await touchWorkspace(account.userId, existing.id)
    return (await loadWorkspaces(account.userId)).find(item => item.id === existing.id)!
  }
  if ((await loadWorkspaces(account.userId)).length >= MAX_WORKSPACES) throw new WorkspaceError('too-many')
  const workspace: Workspace = { id: randomId(12), secret: invite.secret, name: invite.name, list: invite.list, joinedAt: Date.now(), lastOpenedAt: Date.now() }
  await update(account.userId, workspaces => [workspace, ...workspaces])
  return workspace
}
