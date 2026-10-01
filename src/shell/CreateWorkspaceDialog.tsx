import { useBusyAction } from '@codefusion-cc/realtime/react'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { LIMITS } from '../../shared/app.ts'
import { useDevices } from '../account/devicesContext.ts'
import type { Account } from '../auth/session.ts'
import { useI18n } from '../i18nContext.ts'
import { navigate } from '../router.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { EmailsInput } from '../ui/EmailsInput.tsx'
import { createWorkspace, WorkspaceError } from '../workspaces/workspaces.ts'

/** A new workspace: its name and who may join. The person making it is always in. */
export function CreateWorkspaceDialog({ account, open, onClose }: { account: Account; open: boolean; onClose(): void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const { pending: busy, error, setError, run } = useBusyAction()
  const [needsLink, setNeedsLink] = useState(false)
  const { openLink } = useDevices()

  const close = () => {
    if (busy) return
    setName('')
    setEmails([])
    setError(null)
    setNeedsLink(false)
    onClose()
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setNeedsLink(false)
    let created: string | null = null
    await run(async () => { created = (await createWorkspace(account, name, emails)).id }, failure => {
      const reason = failure instanceof WorkspaceError ? failure.reason : null
      setNeedsLink(reason === 'not-linked')
      return reason === 'not-linked' ? t.workspaceNeedsLinkedDevice : reason === 'too-many' ? t.tooManyWorkspaces : reason === 'invalid' ? t.workspaceInvalid : t.workspaceCreateFailed
    })
    if (!created) return
    setName('')
    setEmails([])
    onClose()
    navigate({ name: 'workspace', workspaceId: created })
  }

  return (
    <Dialog open={open} onClose={close} title={t.createWorkspace} description={t.createWorkspaceBody}>
      <form className="space-y-4" onSubmit={event => void submit(event)} noValidate>
        <div>
          <label htmlFor="workspace-name" className="mb-1 block text-sm font-medium">{t.workspaceName}</label>
          <input id="workspace-name" className="input w-full" value={name} maxLength={LIMITS.workspaceName} required autoFocus
            onChange={event => setName(event.target.value)} placeholder={t.workspaceNamePlaceholder} />
        </div>
        <EmailsInput emails={emails} onChange={setEmails} exclude={[account.email]} label={t.inviteByEmail} max={LIMITS.workspaceMembers - 1} />
        <p className="text-sm text-base-content/70">{t.youAreIncluded(account.email)}</p>
        {error && (
          <div role="alert" className="alert alert-error alert-soft text-sm">
            <span>{error}</span>
            {needsLink && <button type="button" className="btn btn-sm" onClick={openLink}>{t.linkThisNow}</button>}
          </div>
        )}
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>{t.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{busy ? t.creating : t.create}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
