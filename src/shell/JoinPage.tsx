import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { verifyMemberList } from '../../shared/memberList.ts'
import { accountKeys } from '../account/devices.ts'
import { signOut, type Account } from '../auth/session.ts'
import { useI18n } from '../i18nContext.ts'
import { navigate } from '../router.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { capabilityOf, isListed, joinWorkspace, readInvite, type Invite } from '../workspaces/workspaces.ts'
import { forgetInvite, inviteHash, rememberInvite, takeInviteHash } from './pendingInvite.ts'

type Check = { state: 'checking' } | { state: 'invalid' } | { state: 'not-listed'; invite: Invite } | { state: 'ready'; invite: Invite }

/** An invite link: whose workspace, whether it lets this account in, and joining. */
export function JoinPage({ account }: { account: Account }) {
  const { t } = useI18n()
  const [check, setCheck] = useState<Check>({ state: 'checking' })
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const invite = readInvite(takeInviteHash())
    void (async () => {
      const valid = invite && invite.list.scope === await capabilityOf(invite) && await verifyMemberList(accountKeys, invite.list)
      if (!active) return
      if (!invite || !valid) return setCheck({ state: 'invalid' })
      setCheck({ state: isListed(account, invite.list) ? 'ready' : 'not-listed', invite })
    })()
    return () => { active = false }
  }, [account])
  const leave = () => { forgetInvite(); navigate('/') }

  const join = async (invite: Invite) => {
    setJoining(true)
    setError(null)
    try {
      const workspace = await joinWorkspace(account, invite)
      forgetInvite()
      navigate({ name: 'workspace', workspaceId: workspace.id }, { replace: true })
    } catch {
      setJoining(false)
      setError(t.joinFailed)
    }
  }

  return (
    <main id="content" className="grid flex-1 place-items-center overflow-y-auto p-4">
      <section className="w-full max-w-md rounded-box border border-base-300 bg-base-100 p-6 shadow-sm">
        {check.state === 'checking' && (
          <p className="flex items-center gap-3" role="status"><Loader2 className="size-5 animate-spin" aria-hidden="true" />{t.checkingInvite}</p>
        )}
        {check.state === 'invalid' && (
          <div className="space-y-3">
            <ShieldAlert className="size-8 text-error" aria-hidden="true" />
            <h1 className="text-xl font-semibold">{t.inviteInvalidTitle}</h1>
            <p className="text-base-content/70">{t.inviteInvalidBody}</p>
            <button type="button" className="btn btn-outline" onClick={leave}>{t.toWorkspaces}</button>
          </div>
        )}
        {check.state === 'not-listed' && (
          <div className="space-y-3">
            <ShieldAlert className="size-8 text-warning" aria-hidden="true" />
            <h1 className="text-xl font-semibold">{t.notListedTitle(check.invite.name)}</h1>
            <p className="text-base-content/70">{t.notListedBody(account.email)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-outline" onClick={leave}>{t.toWorkspaces}</button>
              <button type="button" className="btn btn-ghost" onClick={() => { rememberInvite(inviteHash()); void signOut() }}>{t.signInAsSomeoneElse}</button>
            </div>
          </div>
        )}
        {check.state === 'ready' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={check.invite.name} seed={check.invite.list.scope} size="lg" square />
              <div className="min-w-0">
                <p className="text-sm text-base-content/60">{t.invitedTo}</p>
                <h1 className="truncate text-xl font-semibold">{check.invite.name}</h1>
              </div>
            </div>
            <p className="flex items-start gap-2 text-sm text-base-content/70">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />{t.inviteVerified(check.invite.list.emails.length)}
            </p>
            {error && <div role="alert" className="alert alert-error alert-soft text-sm">{error}</div>}
            <button type="button" className="btn btn-primary btn-block" disabled={joining} onClick={() => void join(check.invite)}>
              {joining && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{t.joinWorkspace}
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
