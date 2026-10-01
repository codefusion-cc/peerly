import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useI18n } from '../i18nContext.ts'

/**
 * A modal on the browser's own <dialog>: it traps focus, closes on Escape and
 * returns focus to what opened it. Closing goes through `onClose`, so the
 * caller decides (and can refuse while something is being saved).
 */
export function Dialog({ open, onClose, title, description, children, actions, wide = false }: {
  open: boolean
  onClose(): void
  title: string
  description?: string
  children: ReactNode
  actions?: ReactNode
  wide?: boolean
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} className="modal modal-bottom sm:modal-middle" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
      onCancel={event => { event.preventDefault(); onClose() }}>
      <div className={`modal-box ${wide ? 'sm:max-w-2xl' : ''}`}>
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-base-content/70">{description}</p>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={onClose} aria-label={t.close}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {children}
        {actions && <div className="modal-action">{actions}</div>}
      </div>
      <form method="dialog" className="modal-backdrop"><button type="button" onClick={onClose} tabIndex={-1}>{t.close}</button></form>
    </dialog>
  )
}
