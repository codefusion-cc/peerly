import { lazy, Suspense, useEffect } from 'react'
import { SignInPage } from './auth/SignInPage.tsx'
import { useAccount } from './auth/useAccount.ts'
import { pageOf, recordView, setErrorPage } from './console.ts'
import { useI18n } from './i18nContext.ts'
import { LegalPage } from './legal/LegalPage.tsx'
import { navigate, useRoute } from './router.ts'
import { rememberInvite } from './shell/pendingInvite.ts'
import { OfflineNotice } from './ui/OfflineNotice.tsx'
import { Spinner } from './ui/Spinner.tsx'
import { UpdateNotice } from './ui/UpdateNotice.tsx'
import { updates } from './updates.ts'

// The signed-in app loads after sign-in: the sign-in page stays small and quick.
const Shell = lazy(() => updates.importOrReload(() => import('./shell/Shell.tsx')))

export function App() {
  const { t } = useI18n()
  const route = useRoute()
  const account = useAccount()

  // Each page counts once a view (no visitor id), names where an error happened, and lets a pending update reload.
  const page = pageOf(route)
  const signedIn = account !== null
  useEffect(() => {
    setErrorPage(page)
    recordView(page, signedIn)
    updates.navigated()
  }, [page, signedIn])

  useEffect(() => {
    if (!account && route.name !== 'signin' && route.name !== 'legal') {
      // Back to where they were going once signed in. An invite's fragment never goes in a URL a server sees:
      // it waits in this tab's session storage for the join page.
      if (route.name === 'join' && location.hash) rememberInvite(location.hash)
      const next = route.name === 'home' ? '' : `?next=${encodeURIComponent(location.pathname)}`
      navigate(`/signin${next}`, { replace: true })
    }
    if (account && route.name === 'signin') navigate('/', { replace: true })
  }, [account, route.name])

  if (route.name === 'legal') return <LegalPage doc={route.document} onBack={() => history.length > 1 ? history.back() : navigate('/')} />
  if (!account) {
    return (
      <>
        <a href="#content" className="sr-only-focusable fixed left-2 top-2 z-50 btn btn-sm">{t.skipToContent}</a>
        <SignInPage />
      </>
    )
  }
  return (
    <>
      <a href="#content" className="sr-only-focusable fixed left-2 top-2 z-50 btn btn-sm">{t.skipToContent}</a>
      <OfflineNotice />
      <UpdateNotice />
      <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label={t.loading} /></div>}>
        <Shell account={account} route={route} />
      </Suspense>
    </>
  )
}
