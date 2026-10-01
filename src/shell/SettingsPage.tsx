import { canLinkThisDevice, DEVICE_NAME_MAX, formatByteSize, type LinkedDevice } from '@codefusion-cc/realtime/browser'
import { useBusyAction, useClockFormat } from '@codefusion-cc/realtime/react'
import {
  ArrowLeft, Check, Cloud, Copy, Database, HardDrive, KeyRound, Laptop, LogOut, Palette, Radio, ShieldCheck, Smartphone, Sparkles, Tablet, User,
} from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useDevices } from '../account/devicesContext.ts'
import { isPremium, useMembership } from '../account/useMembership.ts'
import { signOut, type Account } from '../auth/session.ts'
import { deleteContentDb } from '../content/db.ts'
import type { Locale } from '../i18n.ts'
import { useI18n } from '../i18nContext.ts'
import { navigate, type Route } from '../router.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx'
import { ThemePicker } from '../ui/ThemePicker.tsx'

type Section = Extract<Route, { name: 'settings' }>['section']

/** The account, this account's devices, how Peerly looks, and what it keeps on this device. */
export function SettingsPage({ account, section }: { account: Account; section: Section }) {
  const { t } = useI18n()
  const sections: Array<{ id: Section; label: string; Icon: typeof User }> = [
    { id: 'account', label: t.account, Icon: User },
    { id: 'devices', label: t.devices, Icon: Laptop },
    { id: 'appearance', label: t.appearance, Icon: Palette },
    { id: 'storage', label: t.storage, Icon: HardDrive },
  ]
  return (
    <main id="content" className="scroll-quiet flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
        <header className="mb-6 flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm btn-square md:hidden" onClick={() => navigate('/')} aria-label={t.toWorkspaces}>
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <h1 className="text-2xl font-semibold">{t.settings}</h1>
        </header>
        <nav aria-label={t.settings} className="scroll-quiet -mx-4 mb-6 overflow-x-auto px-4">
          <ul className="flex gap-1 border-b border-base-300">
            {sections.map(({ id, label, Icon }) => (
              <li key={id}>
                <a href={id === 'account' ? '/settings' : `/settings/${id}`} aria-current={section === id ? 'page' : undefined}
                  onClick={event => { event.preventDefault(); navigate({ name: 'settings', section: id }, { replace: true }) }}
                  className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${section === id ? 'border-primary text-primary' : 'border-transparent text-base-content/70 hover:text-base-content'}`}>
                  <Icon className="size-4" aria-hidden="true" />{label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {section === 'account' && <AccountSection account={account} />}
        {section === 'devices' && <DevicesSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'storage' && <StorageSection account={account} />}
      </div>
    </main>
  )
}

function Card({ title, icon, children, description }: { title: string; icon: ReactNode; description?: string; children: ReactNode }) {
  return (
    <section className="mb-5 rounded-box border border-base-300 bg-base-100 p-5">
      <h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2>
      {description && <p className="mt-1 text-sm text-base-content/70">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function AccountSection({ account }: { account: Account }) {
  const { t, locale } = useI18n()
  const membership = useMembership(account.userId)
  const premium = isPremium(membership)
  const until = membership?.until ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(membership.until) : null
  const [leaving, setLeaving] = useState(false)
  const features = [
    { Icon: Radio, free: true, text: t.planP2p },
    { Icon: ShieldCheck, free: true, text: t.planEncrypted },
    { Icon: Cloud, free: false, text: t.planHistory },
    { Icon: Database, free: false, text: t.planFiles },
    { Icon: Sparkles, free: false, text: t.planRelay },
  ]
  return (
    <>
      <Card title={t.account} icon={<User className="size-5 text-primary" aria-hidden="true" />}>
        <div className="flex items-center gap-4">
          <Avatar name={account.name} seed={account.userId} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{account.name}</p>
            <p className="truncate text-sm text-base-content/70">{account.email}</p>
            <p className="text-xs text-base-content/50">{t.signedInWith(t.providerNames[account.provider])}</p>
          </div>
        </div>
        <AccountId userId={account.userId} />
        <button type="button" className="btn btn-outline btn-sm mt-5" onClick={() => setLeaving(true)}>
          <LogOut className="size-4" aria-hidden="true" />{t.signOut}
        </button>
      </Card>

      <Card title={t.plan} icon={<Sparkles className="size-5 text-primary" aria-hidden="true" />}>
        {membership === null ? (
          <div className="skeleton h-24 w-full" aria-busy="true" aria-label={t.loading} />
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <span className={`badge ${premium ? 'badge-primary' : 'badge-ghost'}`}>{premium ? t.premium : t.free}</span>
              <span className="text-sm text-base-content/70">{premium ? (until ? t.premiumUntil(until) : t.premiumActive) : t.freeBody}</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {features.map(({ Icon, free, text }) => {
                const included = free || premium
                return (
                  <li key={text} className={`flex items-start gap-2 ${included ? '' : 'text-base-content/50'}`}>
                    <Icon className={`mt-0.5 size-4 shrink-0 ${included ? 'text-success' : ''}`} aria-hidden="true" />
                    <span>{text}{!free && !premium && <span className="badge badge-ghost badge-xs ml-2">{t.premium}</span>}</span>
                  </li>
                )
              })}
            </ul>
            {!premium && <p className="mt-4 text-sm text-base-content/70">{t.premiumHowTo}</p>}
          </>
        )}
      </Card>
      <ConfirmDialog open={leaving} onClose={() => setLeaving(false)} title={t.signOut} body={t.signOutConfirm}
        action={t.signOut} onConfirm={() => signOut()} />
    </>
  )
}

/** The id staff find this account by (premium, support): Peerly keeps no email to look people up. */
function AccountId({ userId }: { userId: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState<boolean | null>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(userId)
      setCopied(true)
      setTimeout(() => setCopied(null), 2_000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="mt-4 rounded-field bg-base-200 p-3">
      <p className="text-xs font-medium text-base-content/70" id="account-id-label">{t.accountId}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm" aria-labelledby="account-id-label">{userId}</code>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => void copy()}>
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}{copied ? t.copied : t.copy}
        </button>
      </div>
      <p className="mt-1 text-xs text-base-content/60" role={copied === false ? 'alert' : undefined}>{copied === false ? t.copyFailed : t.accountIdHint}</p>
    </div>
  )
}

function DeviceIcon({ name }: { name: string | null }) {
  const Icon = /iPhone|Android/.test(name ?? '') ? Smartphone : /iPad/.test(name ?? '') ? Tablet : Laptop
  return <Icon className="mt-0.5 size-5 shrink-0 text-base-content/60" aria-hidden="true" />
}

function DevicesSection() {
  const { t, locale } = useI18n()
  const { state, actions, openLink, review } = useDevices()
  const { pending, error, setError, run } = useBusyAction()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [unlinking, setUnlinking] = useState<LinkedDevice | null>(null)
  const [resetting, setResetting] = useState(false)
  const view = state?.view
  const linked = Boolean(state?.linked)
  const me = view?.devices.find(device => device.current)?.deviceKeyId ?? null
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const ago = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const name = (device: { name: string | null }) => device.name || t.deviceUnnamed

  const lastSeen = (at: number) => {
    const minutes = Math.round((at - Date.now()) / 60_000)
    if (minutes > -5) return t.activeNow
    if (minutes > -60) return t.activeAgo(ago.format(minutes, 'minute'))
    if (minutes > -60 * 24) return t.activeAgo(ago.format(Math.round(minutes / 60), 'hour'))
    return t.activeAgo(ago.format(Math.round(minutes / 1440), 'day'))
  }
  const saveName = async (event: FormEvent, deviceKeyId: string) => {
    event.preventDefault()
    if (!draft.trim()) return
    if (await run(() => actions.rename(deviceKeyId, draft.trim()), () => t.deviceRenameFailed)) setRenaming(null)
  }

  return (
    <Card title={t.devices} icon={<Laptop className="size-5 text-primary" aria-hidden="true" />} description={t.devicesIntro}>
      {!view && state?.loading !== false && !state?.error && <div className="space-y-2" aria-busy="true" aria-label={t.loading}>{[0, 1].map(index => <div key={index} className="skeleton h-14 w-full" />)}</div>}
      {!view && state?.error && (
        <div role="alert" className="alert alert-error alert-soft">
          <span>{t.devicesFailed}</span>
          <button type="button" className="btn btn-sm" onClick={() => void actions.refresh().catch(() => {})}>{t.retry}</button>
        </div>
      )}
      {error && !unlinking && !resetting && <p role="alert" className="mb-3 text-sm text-error">{error}</p>}
      {state?.replaced && (
        <div role="alert" className="alert alert-warning alert-soft mb-4">
          <span>{t.devicesReplaced}</span>
          <button type="button" className="btn btn-sm" onClick={actions.dismissReplaced}>{t.close}</button>
        </div>
      )}
      {state?.unreadable && <p role="alert" className="alert alert-warning alert-soft mb-4">{t.devicesUnreadable}</p>}
      {canLinkThisDevice(state) && !state?.unreadable && (
        <div className="mb-4 rounded-box border border-primary/30 bg-primary/5 p-4">
          <p className="flex items-start gap-2 text-sm"><KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />{t.linkThisBody}</p>
          <button type="button" className="btn btn-primary btn-sm mt-3" onClick={openLink}>{t.linkThis}</button>
        </div>
      )}

      {linked && Boolean(view?.requests.length) && (
        <section className="mb-4" aria-labelledby="requests-heading">
          <h3 id="requests-heading" className="mb-2 text-sm font-semibold">{t.linkRequests}</h3>
          <ul className="space-y-2">
            {view!.requests.map(request => {
              const elsewhere = Boolean(request.approverDeviceKeyId) && request.approverDeviceKeyId !== me
              return (
                <li key={request.id} className="flex items-center gap-3 rounded-field border border-base-300 px-3 py-2.5">
                  <DeviceIcon name={request.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{name(request)}</p>
                    <p className="text-xs text-base-content/60">{elsewhere ? t.approvingElsewhere : t.waitingForApproval}</p>
                  </div>
                  {!elsewhere && <>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pending}
                      onClick={() => void run(() => actions.deny(request.id), () => t.actionFailed)}>{t.deny}</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => review(request.id)}>{t.approve}</button>
                  </>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {view && (
        <ul className="space-y-2">
          {view.devices.map(device => (
            <li key={device.deviceKeyId} className="rounded-field border border-base-300 px-3 py-2.5">
              {renaming === device.deviceKeyId ? (
                <form className="flex flex-wrap items-center gap-2" onSubmit={event => void saveName(event, device.deviceKeyId)}
                  onKeyDown={event => { if (event.key === 'Escape') setRenaming(null) }}>
                  <label className="input input-sm min-w-0 flex-1">
                    <span className="sr-only">{t.deviceName}</span>
                    <input value={draft} maxLength={DEVICE_NAME_MAX} autoFocus onChange={event => setDraft(event.target.value)} disabled={pending} />
                  </label>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !draft.trim()}>{t.save}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(null)} disabled={pending}>{t.cancel}</button>
                </form>
              ) : (
                <div className="flex items-start gap-3">
                  <DeviceIcon name={device.name} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words text-sm font-semibold">{name(device)}</span>
                      {device.current && <span className="badge badge-primary badge-soft badge-sm">{t.thisDevice}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-base-content/60">
                      <span className={device.linked ? 'font-semibold text-success' : undefined}>
                        {device.linked ? t.deviceLinked : device.signedIn ? t.deviceNotLinked : t.deviceSignedOut}
                      </span>
                      {device.linked && device.linkedAt && <> · {t.linkedOn(date.format(device.linkedAt))}</>}
                      {device.lastSeenAt && !device.current && <> · {lastSeen(device.lastSeenAt)}</>}
                    </p>
                    {(linked || device.current) && (
                      <div className="mt-1.5 flex flex-wrap gap-x-4">
                        <button type="button" className="link link-hover text-xs" disabled={pending}
                          onClick={() => { setRenaming(device.deviceKeyId); setDraft(device.name ?? '') }}>{t.rename}</button>
                        {linked && (
                          <button type="button" className="link link-hover text-xs text-error" disabled={pending}
                            onClick={() => { setError(null); setUnlinking(device) }}>{device.current ? t.unlinkThis : t.unlink}</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {view?.accountKey && !linked && (
        <p className="mt-4 text-sm text-base-content/70">
          {t.resetQuestion}{' '}
          <button type="button" className="link link-primary" onClick={() => { setError(null); setResetting(true) }}>{t.resetKeys}</button>
        </p>
      )}

      <ConfirmDialog open={unlinking !== null} onClose={() => setUnlinking(null)}
        title={unlinking ? t.unlinkTitle(name(unlinking)) : ''} body={unlinking?.current ? t.unlinkThisBody : t.unlinkBody} action={t.unlink}
        onConfirm={async () => {
          if (!unlinking) return
          await actions.unlink(unlinking.deviceKeyId)
          if (unlinking.current) await signOut()
        }} />
      <ConfirmDialog open={resetting} onClose={() => setResetting(false)} title={t.resetTitle} body={t.resetBody} action={t.resetKeys}
        onConfirm={async () => {
          try {
            await actions.reset()
          } catch (thrown) {
            const at = (thrown as { resetAt?: number | null }).resetAt
            setError(at ? t.resetTooSoon(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(at)) : t.actionFailed)
            setResetting(false)
          }
        }} />
    </Card>
  )
}

function AppearanceSection() {
  const { t, locale, setLocale } = useI18n()
  const { clockFormat, setClockFormat } = useClockFormat()
  const sample = new Date(2026, 0, 1, 15, 30).getTime()
  const time = (hourCycle: 'h23' | 'h12') => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle }).format(sample)
  return (
    <Card title={t.appearance} icon={<Palette className="size-5 text-primary" aria-hidden="true" />}>
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium" id="theme-label">{t.theme}</p>
          <ThemePicker />
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-medium">{t.language}</span>
          <select className="select w-full sm:w-64" value={locale} onChange={event => setLocale(event.target.value as Locale)}>
            <option value="en">English</option>
            <option value="pl">Polski</option>
          </select>
        </label>
        <div role="radiogroup" aria-labelledby="clock-label">
          <p className="mb-2 text-sm font-medium" id="clock-label">{t.clock}</p>
          <div className="join">
            {(['24-hour', '12-hour'] as const).map(format => (
              <button key={format} type="button" role="radio" aria-checked={clockFormat === format}
                className={`btn join-item btn-sm ${clockFormat === format ? 'btn-primary' : 'btn-ghost border-base-300'}`}
                onClick={() => setClockFormat(format)}>
                {format === '24-hour' ? t.clock24(time('h23')) : t.clock12(time('h12'))}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}

type Estimate = { usage: number; quota: number; persisted: boolean } | null

function StorageSection({ account }: { account: Account }) {
  const { t, locale } = useI18n()
  const [estimate, setEstimate] = useState<Estimate | 'unavailable'>(null)
  const [clearing, setClearing] = useState(false)
  const [asked, setAsked] = useState(false)

  const read = async () => {
    try {
      const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted()])
      setEstimate({ usage, quota, persisted })
    } catch {
      setEstimate('unavailable')
    }
  }
  useEffect(() => { void read() }, [])

  return (
    <Card title={t.storage} icon={<HardDrive className="size-5 text-primary" aria-hidden="true" />} description={t.storageIntro}>
      {estimate === null ? <div className="skeleton h-16 w-full" aria-busy="true" aria-label={t.loading} /> : estimate === 'unavailable' ? (
        <p className="text-sm text-base-content/70">{t.storageUnavailable}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="flex justify-between text-sm"><span>{t.storageUsed}</span>
              <span className="tabular-nums">{t.storageOf(formatByteSize(estimate.usage, locale), formatByteSize(estimate.quota, locale))}</span></p>
            <progress className="progress progress-primary mt-2 w-full" value={estimate.usage} max={estimate.quota || 1} aria-label={t.storageUsed} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {estimate.persisted ? (
              <span className="flex items-center gap-2 text-success"><ShieldCheck className="size-4" aria-hidden="true" />{t.storagePersisted}</span>
            ) : <>
              <span className="text-base-content/70">{asked ? t.storagePersistRefused : t.storageMayClear}</span>
              {!asked && <button type="button" className="btn btn-sm" onClick={async () => {
                const granted = await navigator.storage.persist().catch(() => false)
                setAsked(!granted)
                void read()
              }}>{t.storageKeep}</button>}
            </>}
          </div>
        </div>
      )}
      <div className="mt-6 border-t border-base-300 pt-4">
        <p className="text-sm text-base-content/70">{t.clearBody}</p>
        <button type="button" className="btn btn-outline btn-error btn-sm mt-3" onClick={() => setClearing(true)}>{t.clearMessages}</button>
      </div>
      <ConfirmDialog open={clearing} onClose={() => setClearing(false)} title={t.clearMessages} body={t.clearConfirm} action={t.clearMessages}
        onConfirm={async () => {
          await deleteContentDb(account.userId)
          // Open workspaces still hold what they read: start again from what is left.
          location.reload()
        }} />
    </Card>
  )
}
