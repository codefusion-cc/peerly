import { Plus, Settings } from 'lucide-react'
import type { Account } from '../auth/session.ts'
import { useI18n } from '../i18nContext.ts'
import { navigate, type Route } from '../router.ts'
import { Avatar } from '../ui/Avatar.tsx'
import type { Workspace } from '../workspaces/workspaces.ts'

/** The column of workspaces on a wide screen: one click between them. Phones use the home page instead. */
export function Rail({ account, workspaces, activeId, route }: {
  account: Account; workspaces: Workspace[] | null; activeId: string | null; route: Route
}) {
  const { t } = useI18n()
  return (
    <nav aria-label={t.workspaces} className="hidden w-18 shrink-0 flex-col items-center gap-2 border-r border-base-300 bg-base-200 py-3 md:flex">
      <a href="/" onClick={event => { event.preventDefault(); navigate('/') }} className="mb-1 rounded-xl" aria-label={t.home}
        aria-current={route.name === 'home' ? 'page' : undefined}>
        <img src="/app-icon.png" alt="" className="size-10 rounded-xl" />
      </a>
      <div className="h-px w-8 bg-base-300" />
      <ul className="scroll-quiet flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-2 py-1">
        {workspaces?.map(workspace => {
          const active = workspace.id === activeId
          return (
            <li key={workspace.id} className="relative">
              {active && <span className="absolute -left-3 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r bg-primary" aria-hidden="true" />}
              <a href={`/w/${workspace.id}`} title={workspace.name} aria-current={active ? 'page' : undefined}
                onClick={event => { event.preventDefault(); navigate({ name: 'workspace', workspaceId: workspace.id }) }}
                className={`block rounded-xl transition ${active ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-200' : 'opacity-85 hover:opacity-100'}`}>
                <Avatar name={workspace.name} seed={workspace.id} square />
                <span className="sr-only">{workspace.name}</span>
              </a>
            </li>
          )
        })}
        <li>
          <a href="/?create" onClick={event => { event.preventDefault(); navigate('/', { hash: '#create' }) }}
            className="grid size-10 place-items-center rounded-xl border border-dashed border-base-content/30 text-base-content/70 transition hover:border-primary hover:text-primary"
            title={t.createWorkspace} aria-label={t.createWorkspace}>
            <Plus className="size-5" aria-hidden="true" />
          </a>
        </li>
      </ul>
      <a href="/settings" onClick={event => { event.preventDefault(); navigate({ name: 'settings', section: 'account' }) }}
        aria-current={route.name === 'settings' ? 'page' : undefined} className="relative rounded-full" title={t.settings} aria-label={t.settings}>
        <Avatar name={account.name} seed={account.userId} size="md" />
        <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-base-100 shadow">
          <Settings className="size-3.5" aria-hidden="true" />
        </span>
      </a>
    </nav>
  )
}
