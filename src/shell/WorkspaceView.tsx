import { ChevronDown, Cloud, Hash, Headphones, Loader2, LogOut, MoreHorizontal, Pencil, Plus, Radio, ShieldAlert, Trash2, UserPlus, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { isPremium, useMembership } from '../account/useMembership.ts'
import type { Account } from '../auth/session.ts'
import { forgetContent } from '../content/db.ts'
import type { Channel } from '../content/derive.ts'
import { useI18n } from '../i18nContext.ts'
import { navigate } from '../router.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx'
import { Spinner } from '../ui/Spinner.tsx'
import { forgetNames, type SessionView, type WorkspaceSession } from '../workspaces/session.ts'
import { useSessionView, useWorkspaceSession } from '../workspaces/useWorkspace.ts'
import { isOwner, leaveWorkspace, touchWorkspace, type Workspace } from '../workspaces/workspaces.ts'
import { callMembers, joinCall, useCall } from '../calls/useCall.ts'
import { CallStage } from './CallStage.tsx'
import { ChannelView } from './ChannelView.tsx'
import { MembersDialog } from './MembersDialog.tsx'
import { NameDialog } from './NameDialog.tsx'

/** One workspace: its channels and who is here beside the channel open now. */
export function WorkspaceView({ account, workspaces, workspaceId, channelId }: {
  account: Account; workspaces: Workspace[] | null; workspaceId: string; channelId: string | null
}) {
  const { t } = useI18n()
  const workspace = workspaces?.find(item => item.id === workspaceId) ?? null
  const session = useWorkspaceSession(account, workspace, t.defaultChannelName)
  const view = useSessionView(session)
  const channel = view.channels.find(item => item.id === channelId) ?? null

  const openedId = workspace?.id
  useEffect(() => { if (openedId) void touchWorkspace(account.userId, openedId) }, [account.userId, openedId])
  // On a wide screen a workspace opens on its first channel.
  useEffect(() => {
    if (!channelId && view.channels.length && window.matchMedia('(min-width: 48rem)').matches) {
      navigate({ name: 'workspace', workspaceId, channelId: view.channels[0].id }, { replace: true })
    }
  }, [channelId, view.channels, workspaceId])

  if (workspaces && !workspace) {
    return (
      <main id="content" className="grid flex-1 place-items-center p-6 text-center">
        <div className="space-y-3">
          <h1 className="text-xl font-semibold">{t.workspaceGoneTitle}</h1>
          <p className="text-base-content/70">{t.workspaceGoneBody}</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>{t.toWorkspaces}</button>
        </div>
      </main>
    )
  }
  if (!workspace || !session) return <div className="grid flex-1 place-items-center"><Spinner label={t.loading} /></div>
  if (view.status === 'refused') return <Refused account={account} workspace={workspace} reason={view.refused} />

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar account={account} workspace={workspace} session={session} view={view} channelId={channelId}
        className={channelId ? 'hidden md:flex' : 'flex'} />
      <div className={`min-w-0 flex-1 flex-col ${channelId ? 'flex' : 'hidden md:flex'}`}>
        <CallStage account={account} session={session} view={view} />
        {channel ? (
          <ChannelView key={channel.id} account={account} workspace={workspace} session={session} view={view} channel={channel} />
        ) : channelId && view.channels.length ? (
          <div className="grid flex-1 place-items-center p-6 text-center text-base-content/70">{t.channelGone}</div>
        ) : (
          <div className="grid flex-1 place-items-center p-6 text-center text-base-content/70">
            {view.channels.length ? t.pickChannel : t.waitingForChannels}
          </div>
        )}
      </div>
    </div>
  )
}

function Sidebar({ account, workspace, session, view, channelId, className }: {
  account: Account; workspace: Workspace; session: WorkspaceSession; view: SessionView; channelId: string | null; className: string
}) {
  const { t } = useI18n()
  const membership = useMembership(account.userId)
  const owner = isOwner(account, workspace)
  const [dialog, setDialog] = useState<null | 'members' | 'rename' | 'new-channel' | 'leave'>(null)
  const [renaming, setRenaming] = useState<Channel | null>(null)
  const [deleting, setDeleting] = useState<Channel | null>(null)
  const openPeers = view.peers.filter(peer => peer.state === 'open').length
  const others = useMemo(() => view.online.filter(person => person.userId !== account.userId), [view.online, account.userId])

  const leave = async () => {
    await leaveWorkspace(account.userId, workspace.id)
    await forgetContent(account.userId, workspace.id).catch(() => {})
    forgetNames(account.userId, workspace.id)
    navigate('/')
  }

  return (
    <aside className={`${className} w-full min-h-0 flex-col border-r border-base-300 bg-base-100 md:w-72`} aria-label={view.name}>
      <header className="flex items-center gap-2 border-b border-base-300 px-3 py-2">
        <button type="button" className="btn btn-ghost btn-sm btn-square md:hidden" onClick={() => navigate('/')} aria-label={t.toWorkspaces}>
          <Avatar name={workspace.name} seed={workspace.id} size="xs" square />
        </button>
        <div className="dropdown min-w-0 flex-1">
          <button type="button" className="btn btn-ghost btn-sm w-full justify-between px-2 text-base font-semibold" aria-haspopup="menu">
            <span className="truncate">{view.name}</span><ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </button>
          <ul tabIndex={0} role="menu" className="menu dropdown-content z-20 mt-1 w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
            <li role="none"><button type="button" role="menuitem" onClick={() => setDialog('members')}>
              {owner ? <UserPlus className="size-4" aria-hidden="true" /> : <Users className="size-4" aria-hidden="true" />}{owner ? t.inviteAndMembers : t.members}
            </button></li>
            {owner && <li role="none"><button type="button" role="menuitem" onClick={() => setDialog('rename')}><Pencil className="size-4" aria-hidden="true" />{t.renameWorkspace}</button></li>}
            <li role="none"><button type="button" role="menuitem" className="text-error" onClick={() => setDialog('leave')}><LogOut className="size-4" aria-hidden="true" />{t.leaveWorkspace}</button></li>
          </ul>
        </div>
        <CallButton account={account} session={session} />
      </header>

      <div className="space-y-1.5 border-b border-base-300 px-4 py-2.5 text-xs text-base-content/70">
        <p className="flex items-center gap-1.5" role="status">
          <span className={`size-2 shrink-0 rounded-full ${view.status === 'online' ? 'bg-success' : 'bg-warning'}`} aria-hidden="true" />
          <span className="flex-1">{view.status === 'online' ? t.connected : view.status === 'reconnecting' ? t.reconnecting : t.connecting}</span>
          {view.status === 'online' && (
            <span className="flex items-center gap-1 tabular-nums" title={t.directLinks(openPeers)}>
              <Radio className="size-3.5" aria-hidden="true" />{openPeers}<span className="sr-only"> {t.directLinks(openPeers)}</span>
            </span>
          )}
        </p>
        <p className="flex items-start gap-1.5">
          <Cloud className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{view.history ? t.historyOn : t.historyOff}</span>
          {!view.history && owner && membership && !isPremium(membership) && (
            <a href="/settings" className="badge badge-primary badge-soft badge-xs shrink-0" title={t.planHistory}
              onClick={event => { event.preventDefault(); navigate({ name: 'settings', section: 'account' }) }}>{t.premium}</a>
          )}
        </p>
      </div>

      <nav className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label={t.channels}>
        <div className="mb-1 flex items-center justify-between px-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">{t.channels}</h2>
          <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={() => setDialog('new-channel')} aria-label={t.newChannel}>
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>
        <ul className="space-y-0.5">
          {view.channels.map(channel => {
            const active = channel.id === channelId
            return (
              <li key={channel.id} className="group flex items-center">
                <a href={`/w/${workspace.id}/c/${channel.id}`} aria-current={active ? 'page' : undefined}
                  onClick={event => { event.preventDefault(); navigate({ name: 'workspace', workspaceId: workspace.id, channelId: channel.id }) }}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-field px-2 py-1.5 text-sm ${active ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-base-200'}`}>
                  <Hash className="size-4 shrink-0 opacity-60" aria-hidden="true" /><span className="truncate">{channel.name}</span>
                </a>
                <div className="dropdown dropdown-end">
                  <button type="button" className="btn btn-ghost btn-xs btn-square opacity-0 focus:opacity-100 group-hover:opacity-100" aria-label={t.channelActions(channel.name)}>
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </button>
                  <ul tabIndex={0} className="menu dropdown-content z-20 w-48 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg">
                    <li><button type="button" onClick={() => setRenaming(channel)}><Pencil className="size-4" aria-hidden="true" />{t.renameChannel}</button></li>
                    {view.channels.length > 1 && (
                      <li><button type="button" className="text-error" onClick={() => setDeleting(channel)}><Trash2 className="size-4" aria-hidden="true" />{t.deleteChannel}</button></li>
                    )}
                  </ul>
                </div>
              </li>
            )
          })}
        </ul>

        <h2 className="mb-1 mt-5 px-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">{t.onlineNow(others.length + 1)}</h2>
        <ul className="space-y-0.5">
          {[{ userId: account.userId }, ...others].map(person => {
            const name = view.profiles[person.userId]?.name ?? t.someone
            const linked = view.peers.some(peer => peer.userId === person.userId && peer.state === 'open')
            return (
              <li key={person.userId} className="flex items-center gap-2 rounded-field px-2 py-1 text-sm">
                <Avatar name={name} seed={person.userId} size="xs" online />
                <span className="min-w-0 flex-1 truncate">{name}{person.userId === account.userId && <span className="text-base-content/50"> ({t.you})</span>}</span>
                {person.userId !== account.userId && (
                  <span className={`text-xs ${linked ? 'text-success' : 'text-base-content/40'}`} title={linked ? t.linkedDirectly : t.linking}>
                    <Radio className="size-3" aria-hidden="true" /><span className="sr-only">{linked ? t.linkedDirectly : t.linking}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      <MembersDialog open={dialog === 'members'} onClose={() => setDialog(null)} account={account} workspace={workspace} session={session} />
      <NameDialog open={dialog === 'rename'} onClose={() => setDialog(null)} title={t.renameWorkspace} label={t.workspaceName}
        initial={view.name} onSave={name => session.rename(name)} max={120} />
      <NameDialog open={dialog === 'new-channel'} onClose={() => setDialog(null)} title={t.newChannel} label={t.channelName}
        initial="" onSave={async name => {
          const op = await session.createChannel(name)
          if (op.kind === 'chan') navigate({ name: 'workspace', workspaceId: workspace.id, channelId: op.c })
        }} max={80} />
      <NameDialog open={renaming !== null} onClose={() => setRenaming(null)} title={t.renameChannel} label={t.channelName}
        initial={renaming?.name ?? ''} onSave={name => renaming ? session.renameChannel(renaming, name) : undefined} max={80} />
      <ConfirmDialog open={deleting !== null} onClose={() => setDeleting(null)} title={t.deleteChannel}
        body={deleting ? t.deleteChannelConfirm(deleting.name) : ''} action={t.deleteChannel} onConfirm={async () => {
          if (!deleting) return
          await session.deleteChannel(deleting)
          if (deleting.id === channelId) navigate({ name: 'workspace', workspaceId: workspace.id })
        }} />
      <ConfirmDialog open={dialog === 'leave'} onClose={() => setDialog(null)} title={t.leaveWorkspace}
        body={t.leaveConfirm(view.name)} action={t.leaveWorkspace} onConfirm={leave} />
    </aside>
  )
}

/** Joins the workspace's call from its header: how many are in it, and whether this page is. */
function CallButton({ account, session }: { account: Account; session: WorkspaceSession }) {
  const { t } = useI18n()
  const state = useCall(session)
  const count = callMembers(state, account.userId).length
  const [joining, setJoining] = useState(false)
  return (
    <button type="button" className={`btn btn-sm btn-square indicator ${state.joined ? 'btn-success' : 'btn-ghost'}`}
      disabled={joining} aria-pressed={state.joined} title={state.joined ? t.leaveTheCall : count ? t.joinCall : t.startCall}
      aria-label={state.joined ? t.leaveTheCall : count ? `${t.joinCall} (${count})` : t.startCall}
      onClick={async () => {
        if (state.joined) { session.call.leave(); return }
        setJoining(true)
        await joinCall(session)
        setJoining(false)
      }}>
      {count > 0 && !state.joined && <span className="indicator-item badge badge-success badge-xs">{count}</span>}
      {joining ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Headphones className="size-4" aria-hidden="true" />}
    </button>
  )
}

function Refused({ account, workspace, reason }: { account: Account; workspace: Workspace; reason: SessionView['refused'] }) {
  const { t } = useI18n()
  return (
    <main id="content" className="grid flex-1 place-items-center p-6 text-center">
      <div className="max-w-md space-y-3">
        <ShieldAlert className="mx-auto size-10 text-warning" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{t.refusedTitle(workspace.name)}</h1>
        <p className="text-base-content/70">{reason === 'not-listed' ? t.notListedBody(account.email) : t.refusedBody}</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>{t.toWorkspaces}</button>
      </div>
    </main>
  )
}
