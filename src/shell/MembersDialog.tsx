import { useBusyAction } from '@codefusion-cc/realtime/react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LIMITS } from '../../shared/app.ts'
import type { Account } from '../auth/session.ts'
import { useI18n } from '../i18nContext.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { EmailsInput } from '../ui/EmailsInput.tsx'
import type { WorkspaceSession } from '../workspaces/session.ts'
import { inviteLink, isOwner, setMembers, WorkspaceError, type Workspace } from '../workspaces/workspaces.ts'

/**
 * Who may be in the workspace. Its owner changes the list (signed with their
 * account key) and copies the invite link; everyone else sees who is listed.
 */
export function MembersDialog({ open, onClose, account, workspace, session }: {
  open: boolean; onClose(): void; account: Account; workspace: Workspace; session: WorkspaceSession
}) {
  const { t } = useI18n()
  const owner = isOwner(account, workspace)
  const others = workspace.list.emails.filter(email => email !== account.email)
  const [emails, setEmails] = useState(others)
  const { pending: busy, error, setError, run } = useBusyAction()
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (open) { setEmails(workspace.list.emails.filter(email => email !== account.email)); setError(null) } }, [open, workspace.list, account.email, setError])

  const changed = emails.length !== others.length || emails.some(email => !others.includes(email))
  const save = () => run(async () => {
    session.workspace = await setMembers(account, workspace, emails)
    session.shareList()
  }, failure => failure instanceof WorkspaceError && (failure.reason === 'not-owner' || failure.reason === 'not-linked') ? t.membersNeedOwnerDevice : t.actionFailed)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(workspace))
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch {
      setError(t.copyFailed)
    }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title={owner ? t.inviteAndMembers : t.members} wide
      description={owner ? t.membersOwnerBody : t.membersBody}>
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t.inviteLink}</h3>
          <p className="text-sm text-base-content/70">{t.inviteLinkBody}</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void copy()} aria-live="polite">
            {copied ? <Check className="size-4 text-success" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? t.copied : t.copyInviteLink}
          </button>
        </section>
        {owner ? (
          <EmailsInput emails={emails} onChange={setEmails} exclude={[account.email]} label={t.whoMayJoin} max={LIMITS.workspaceMembers - 1} />
        ) : (
          <section>
            <h3 className="mb-2 text-sm font-medium">{t.whoMayJoin}</h3>
            <ul className="flex flex-wrap gap-1.5">
              {workspace.list.emails.map(email => <li key={email} className="badge badge-soft">{email}</li>)}
            </ul>
          </section>
        )}
        {error && <div role="alert" className="alert alert-error alert-soft text-sm">{error}</div>}
        {owner && (
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t.close}</button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!changed || busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{t.saveMembers}
            </button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
