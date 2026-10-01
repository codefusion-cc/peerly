import { useI18n } from '../i18nContext.ts'
import { navigate } from '../router.ts'

export function NotFound() {
  const { t } = useI18n()
  return (
    <main id="content" className="grid flex-1 place-items-center p-6 text-center">
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">{t.notFoundTitle}</h1>
        <p className="text-base-content/70">{t.notFoundBody}</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>{t.toWorkspaces}</button>
      </div>
    </main>
  )
}
