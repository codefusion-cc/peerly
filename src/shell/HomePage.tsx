import { ArrowRight, Link2, Plus, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Account } from '../auth/session.ts'
import { useI18n } from '../i18nContext.ts'
import { navigate, useHash } from '../router.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { readInvite, type Workspace } from '../workspaces/workspaces.ts'
import { AccountMenu } from './AccountMenu.tsx'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog.tsx'

/** The workspaces on this device, and making or joining one. On a phone it is where everything starts. */
export function HomePage({ account, workspaces }: { account: Account; workspaces: Workspace[] | null }) {
  const { t, locale } = useI18n()
  const hash = useHash()
  const [creatingHere, setCreating] = useState(false)
  const creating = creatingHere || hash === '#create'
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  const closeCreate = () => {
    setCreating(false)
    if (location.hash === '#create') history.replaceState(null, '', location.pathname)
  }
  const openLink = (event: FormEvent) => {
    event.preventDefault()
    const hash = (() => { try { return new URL(link.trim()).hash } catch { return link.trim().startsWith('#') ? link.trim() : '' } })()
    if (!readInvite(hash)) {
      setLinkError(t.inviteLinkInvalid)
      return
    }
    navigate('/join', { hash })
  }
  const lastOpened = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  return (
    <main id="content" className="scroll-quiet flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 sm:py-10">
        <header className="flex items-center gap-3">
          <img src="/app-icon.png" alt="" className="size-9 rounded-xl md:hidden" />
          <h1 className="flex-1 text-2xl font-semibold">{t.workspaces}</h1>
          <AccountMenu account={account} />
        </header>

        {workspaces === null ? (
          <div className="space-y-3" aria-busy="true" aria-label={t.loading}>
            {[0, 1, 2].map(index => <div key={index} className="skeleton h-16 w-full" />)}
          </div>
        ) : workspaces.length === 0 ? (
          <section className="rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center">
            <Users className="mx-auto size-10 text-primary" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold">{t.noWorkspacesTitle}</h2>
            <p className="mx-auto mt-1 max-w-md text-base-content/70">{t.noWorkspacesBody}</p>
            <button type="button" className="btn btn-primary mt-5" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />{t.createWorkspace}
            </button>
          </section>
        ) : (
          <section aria-labelledby="workspaces-heading" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="workspaces-heading" className="text-sm font-semibold uppercase tracking-wide text-base-content/60">{t.yourWorkspaces}</h2>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden="true" />{t.createWorkspace}
              </button>
            </div>
            <ul className="divide-y divide-base-300 overflow-hidden rounded-box border border-base-300 bg-base-100">
              {workspaces.map(workspace => (
                <li key={workspace.id}>
                  <a href={`/w/${workspace.id}`} onClick={event => { event.preventDefault(); navigate({ name: 'workspace', workspaceId: workspace.id }) }}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-base-200 focus-visible:bg-base-200">
                    <Avatar name={workspace.name} seed={workspace.id} square />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{workspace.name}</span>
                      <span className="block text-sm text-base-content/60">
                        {t.memberCount(workspace.list.emails.length)} · {lastOpened.format(Math.round((workspace.lastOpenedAt - Date.now()) / 86_400_000), 'day')}
                      </span>
                    </span>
                    <ArrowRight className="size-4 text-base-content/40" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="join-heading" className="rounded-box border border-base-300 bg-base-100 p-5">
          <h2 id="join-heading" className="flex items-center gap-2 font-semibold"><Link2 className="size-4" aria-hidden="true" />{t.joinWithLink}</h2>
          <p className="mt-1 text-sm text-base-content/70">{t.joinWithLinkBody}</p>
          <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={openLink}>
            <label className="input w-full sm:flex-1">
              <span className="sr-only">{t.inviteLink}</span>
              <input value={link} onChange={event => { setLink(event.target.value); setLinkError(null) }} placeholder={t.inviteLinkPlaceholder}
                aria-invalid={linkError !== null} aria-describedby={linkError ? 'invite-link-error' : undefined} autoComplete="off" spellCheck={false} />
            </label>
            <button type="submit" className="btn btn-outline" disabled={!link.trim()}>{t.open}</button>
          </form>
          {linkError && <p id="invite-link-error" role="alert" className="mt-2 text-sm text-error">{linkError}</p>}
        </section>
      </div>
      <CreateWorkspaceDialog account={account} open={creating} onClose={closeCreate} />
    </main>
  )
}
