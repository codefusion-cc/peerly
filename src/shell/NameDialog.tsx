import { useBusyAction } from '@codefusion-cc/realtime/react'
import { Loader2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useI18n } from '../i18nContext.ts'
import { Dialog } from '../ui/Dialog.tsx'

/** Asks for one name (a workspace's, a channel's): trimmed, required, and saved with visible progress. */
export function NameDialog({ open, onClose, title, label, initial, onSave, max }: {
  open: boolean; onClose(): void; title: string; label: string; initial: string; onSave(name: string): Promise<unknown> | unknown; max: number
}) {
  const { t } = useI18n()
  const [name, setName] = useState(initial)
  const { pending: busy, error, setError, run } = useBusyAction()
  useEffect(() => { if (open) { setName(initial); setError(null) } }, [open, initial, setError])
  const clean = name.trim().replace(/\s+/g, ' ')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!clean) return
    if (await run(async () => { await onSave(clean) }, () => t.actionFailed)) onClose()
  }
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title={title}>
      <form onSubmit={event => void submit(event)} className="space-y-4">
        <div>
          <label htmlFor="name-dialog-input" className="mb-1 block text-sm font-medium">{label}</label>
          <input id="name-dialog-input" className="input w-full" value={name} maxLength={max} required autoFocus onChange={event => setName(event.target.value)} />
        </div>
        {error && <div role="alert" className="alert alert-error alert-soft text-sm">{error}</div>}
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={!clean || clean === initial || busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{t.save}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
