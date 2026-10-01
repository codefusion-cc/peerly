import { useBusyAction } from '@codefusion-cc/realtime/react'
import { Loader2 } from 'lucide-react'
import { useI18n } from '../i18nContext.ts'
import { Dialog } from './Dialog.tsx'

/** Asks before something that cannot be undone; the button names the action, and shows it working. */
export function ConfirmDialog({ open, title, body, action, onConfirm, onClose }: {
  open: boolean; title: string; body: string; action: string; onConfirm(): Promise<unknown> | unknown; onClose(): void
}) {
  const { t } = useI18n()
  const { pending: busy, error, run } = useBusyAction()
  const confirm = async () => { if (await run(async () => { await onConfirm() }, () => t.actionFailed)) onClose() }
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title={title} description={body}
      actions={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t.cancel}</button>
        <button type="button" className="btn btn-error" onClick={() => void confirm()} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{action}
        </button>
      </>}>
      {error && <div role="alert" className="alert alert-error alert-soft text-sm">{error}</div>}
    </Dialog>
  )
}
