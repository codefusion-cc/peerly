import { approvalFinished, approvalToShow, linkActive, type DevicesState } from '@codefusion-cc/realtime/browser'
import { LIMITS } from '@codefusion-cc/realtime/protocol'
import { useBusyAction, useLinkedDevices, type LinkedDevicesActions } from '@codefusion-cc/realtime/react'
import { DevicesContext } from './devicesContext.ts'
import { CircleCheck, KeyRound, Loader2, MonitorSmartphone, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '../i18nContext.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { followDevices, linkedDevices } from './devices.ts'

/**
 * Keeps the account's devices current while signed in, and shows the two
 * dialogs of linking wherever the person is: linking this device, and on a
 * linked one, approving a new device.
 */
export function DevicesProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { state, actions } = useLinkedDevices(linkedDevices, userId)
  const [linkOpen, setLinkOpen] = useState(false)
  const [later, setLater] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => followDevices(userId), [userId])

  const link = state?.link
  const openLink = useCallback(() => {
    setLinkOpen(true)
    if (!link || link.state === 'ended' || link.state === 'failed') void actions?.startLink().catch(() => {})
  }, [actions, link])
  const review = useCallback((requestId: string) => {
    setLater(current => { const next = new Set(current); next.delete(requestId); return next })
  }, [])
  const value = useMemo(() => actions ? { state, actions, openLink, review } : null, [state, actions, openLink, review])
  if (!value) return null

  return (
    <DevicesContext.Provider value={value}>
      {children}
      <LinkDialog open={linkOpen} state={state} actions={value.actions} onClose={() => {
        setLinkOpen(false)
        if (state?.link && !linkActive(state.link)) value.actions.dismissLink()
      }} />
      <ApprovalDialog state={state} actions={value.actions} later={later}
        onLater={requestId => setLater(current => new Set(current).add(requestId))} />
    </DevicesContext.Provider>
  )
}

/** The six digits both devices show, in two groups so they are easy to compare; read one by one. */
function LinkCode({ code }: { code: string }) {
  const { t } = useI18n()
  return (
    <figure className="mt-4 rounded-box bg-base-200 px-4 py-5 text-center">
      <figcaption className="text-xs font-semibold uppercase tracking-wide text-base-content/60">{t.linkCodeLabel}</figcaption>
      <p className="mt-2 font-mono text-4xl font-bold tracking-widest tabular-nums" data-testid="link-code" aria-label={code.split('').join(' ')}>
        {code.slice(0, 3)}<span className="inline-block w-3" aria-hidden="true" />{code.slice(3)}
      </p>
    </figure>
  )
}

function Status({ children }: { children: ReactNode }) {
  return <p role="status" className="mt-4 flex items-center gap-2 text-sm text-base-content/70"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{children}</p>
}

/** This device asking to be linked: what to do on the other device, the code to compare, then done (or refused, with a retry). */
function LinkDialog({ open, state, actions, onClose }: { open: boolean; state: DevicesState | null; actions: LinkedDevicesActions; onClose(): void }) {
  const { t } = useI18n()
  const { pending, error, run } = useBusyAction()
  const link = state?.link
  const phase = link?.state ?? 'waiting'
  const active = !link || linkActive(link)
  const comparing = phase === 'code' && Boolean(link?.code) && !link?.confirmed
  const cancel = () => { void actions.cancelLink().catch(() => {}); onClose() }

  return (
    <Dialog open={open} onClose={onClose} title={t.linkTitle}
      actions={comparing ? <>
        <button type="button" className="btn btn-ghost" onClick={cancel} disabled={pending}>{t.linkMismatch}</button>
        <button type="button" className="btn btn-primary" disabled={pending}
          onClick={() => { if (link?.code) void run(() => actions.confirmLink(link.code!), () => t.linkFailed) }}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{t.linkMatch}
        </button>
      </> : active ? <>
        <button type="button" className="btn btn-ghost" onClick={cancel}>{t.linkCancel}</button>
        <button type="button" className="btn" onClick={onClose}>{t.close}</button>
      </> : phase === 'linked' ? (
        <button type="button" className="btn btn-primary" onClick={onClose}>{t.done}</button>
      ) : <>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t.close}</button>
        <button type="button" className="btn btn-primary" onClick={() => void actions.startLink().catch(() => {})}>{t.retry}</button>
      </>}>
      <div aria-live="polite" className="text-sm">
        {phase === 'waiting' && <>
          <p className="flex gap-3"><KeyRound className="size-5 shrink-0 text-primary" aria-hidden="true" />{t.linkWaiting}</p>
          <Status>{t.linkWaitingStatus}</Status>
        </>}
        {phase === 'code' && link?.code && <>
          {comparing && <p>{t.linkCompare}</p>}
          <LinkCode code={link.code} />
          {link.confirmed && <Status>{t.linkConfirmed}</Status>}
        </>}
        {phase === 'linked' && <p role="status" className="flex gap-3"><CircleCheck className="size-5 shrink-0 text-success" aria-hidden="true" />{t.linkDone}</p>}
        {phase === 'ended' && <p role="alert" className="alert alert-warning alert-soft">{t.linkEnded}</p>}
        {phase === 'full' && <p role="alert" className="alert alert-warning alert-soft">{t.linkFull(LIMITS.linkedDevicesPerAccount)}</p>}
        {phase === 'failed' && <p role="alert" className="alert alert-error alert-soft">{t.linkFailed}</p>}
        {error && phase === 'code' && <p role="alert" className="alert alert-error alert-soft mt-4">{error}</p>}
      </div>
    </Dialog>
  )
}

/**
 * On a linked device, a new device of the account asking for its keys: a
 * warning to approve only one's own, the code once the new device answers,
 * and approval only when the person says both codes match.
 */
function ApprovalDialog({ state, actions, later, onLater }: {
  state: DevicesState | null; actions: LinkedDevicesActions; later: ReadonlySet<string>; onLater(requestId: string): void
}) {
  const { t } = useI18n()
  const { pending, run } = useBusyAction()
  const shown = approvalToShow(state, later)
  if (!shown) return null
  const { id, approval, request } = shown
  const name = request?.name || approval?.name || t.deviceUnnamed
  const phase = approval?.state ?? 'new'
  const close = () => {
    if (approvalFinished(approval)) actions.dismissApproval(id)
    onLater(id)
  }
  const act = (work: () => Promise<unknown>) => { void run(work) }
  const deny = () => act(() => actions.deny(id))

  return (
    <Dialog open onClose={close} title={t.approveTitle}
      actions={phase === 'new' ? <>
        <button type="button" className="btn btn-ghost" onClick={close} disabled={pending}>{t.approveLater}</button>
        <button type="button" className="btn" onClick={deny} disabled={pending}>{t.deny}</button>
        <button type="button" className="btn btn-primary" onClick={() => act(() => actions.beginApproval(id))} disabled={pending}>{t.approveStart}</button>
      </> : phase === 'waiting' ? (
        <button type="button" className="btn" onClick={deny} disabled={pending}>{t.deny}</button>
      ) : phase === 'code' ? <>
        <button type="button" className="btn" onClick={deny} disabled={pending}>{t.approveReject}</button>
        <button type="button" className="btn btn-primary" onClick={() => act(() => actions.confirmApproval(id))} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{t.approveConfirm}
        </button>
      </> : phase === 'mismatch' ? (
        <button type="button" className="btn btn-error" onClick={deny} disabled={pending}>{t.deny}</button>
      ) : (
        <button type="button" className="btn btn-primary" onClick={close}>{t.close}</button>
      )}>
      <div aria-live="polite" className="space-y-4 text-sm">
        {(phase === 'new' || phase === 'waiting') && (
          <p className="flex gap-3"><MonitorSmartphone className="size-5 shrink-0 text-primary" aria-hidden="true" />{t.approveIntro(name)}</p>
        )}
        {phase === 'new' && <p className="alert alert-warning alert-soft">{t.approveWarning}</p>}
        {phase === 'waiting' && <Status>{t.approveWaiting}</Status>}
        {phase === 'code' && approval?.code && <><p>{t.approveCompare}</p><LinkCode code={approval.code} /></>}
        {phase === 'approved' && <p role="status" className="flex gap-3"><CircleCheck className="size-5 shrink-0 text-success" aria-hidden="true" />{t.approveDone(name)}</p>}
        {phase === 'mismatch' && <p role="alert" className="alert alert-error alert-soft"><ShieldAlert className="size-5" aria-hidden="true" />{t.approveMismatch}</p>}
        {phase === 'full' && <p role="alert" className="alert alert-warning alert-soft">{t.approveFull(LIMITS.linkedDevicesPerAccount)}</p>}
        {phase === 'failed' && <p role="alert" className="alert alert-error alert-soft">{t.approveFailed}</p>}
      </div>
    </Dialog>
  )
}
