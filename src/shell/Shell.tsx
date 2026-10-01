import { ClockFormatProvider } from '@codefusion-cc/realtime/react'
import { DevicesProvider } from '../account/DevicesProvider.tsx'
import type { Account } from '../auth/session.ts'
import { APP_ID } from '../config.ts'
import type { Route } from '../router.ts'
import { useWorkspaces } from '../workspaces/useWorkspace.ts'
import { HomePage } from './HomePage.tsx'
import { JoinPage } from './JoinPage.tsx'
import { Rail } from './Rail.tsx'
import { SettingsPage } from './SettingsPage.tsx'
import { WorkspaceView } from './WorkspaceView.tsx'
import { NotFound } from './NotFound.tsx'

/** The signed-in app: the workspace rail beside whatever page the URL names. */
export default function Shell({ account, route }: { account: Account; route: Route }) {
  const workspaces = useWorkspaces(account)

  const activeId = route.name === 'workspace' ? route.workspaceId : null
  return (
    <ClockFormatProvider appId={APP_ID}>
      <DevicesProvider userId={account.userId}>
        <div className="flex h-full min-h-0">
          <Rail account={account} workspaces={workspaces} activeId={activeId} route={route} />
          <div className="flex min-w-0 flex-1 flex-col">
            {route.name === 'home' && <HomePage account={account} workspaces={workspaces} />}
            {route.name === 'workspace' && (
              <WorkspaceView key={route.workspaceId} account={account} workspaces={workspaces}
                workspaceId={route.workspaceId} channelId={route.channelId ?? null} />
            )}
            {route.name === 'join' && <JoinPage account={account} />}
            {route.name === 'settings' && <SettingsPage account={account} section={route.section} />}
            {route.name === 'not-found' && <NotFound />}
          </div>
        </div>
      </DevicesProvider>
    </ClockFormatProvider>
  )
}
