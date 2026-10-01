import { LogOut, Settings } from 'lucide-react'
import { signOut, type Account } from '../auth/session.ts'
import { useI18n } from '../i18nContext.ts'
import { navigate } from '../router.ts'
import { Avatar } from '../ui/Avatar.tsx'

/** Who is signed in, with settings and signing out: in the header where the rail is hidden. */
export function AccountMenu({ account }: { account: Account }) {
  const { t } = useI18n()
  return (
    <div className="dropdown dropdown-end">
      <button type="button" className="btn btn-ghost btn-circle" aria-label={t.accountMenu(account.name)}>
        <Avatar name={account.name} seed={account.userId} size="sm" />
      </button>
      <ul tabIndex={0} className="menu dropdown-content z-20 mt-2 w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
        <li className="menu-title">
          <span className="block truncate text-base-content">{account.name}</span>
          <span className="block truncate font-normal">{account.email}</span>
        </li>
        <li><button type="button" onClick={() => navigate({ name: 'settings', section: 'account' })}><Settings className="size-4" aria-hidden="true" />{t.settings}</button></li>
        <li><button type="button" onClick={() => void signOut()}><LogOut className="size-4" aria-hidden="true" />{t.signOut}</button></li>
      </ul>
    </div>
  )
}
