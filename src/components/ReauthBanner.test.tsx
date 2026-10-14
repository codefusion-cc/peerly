// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ChatContext, MediaContext } from '../context/collabContexts'
import type { ChatSlice, MediaSlice } from '../context/collabTypes'
import { resetIdentityProviderCache } from '../collab/identityProviders'
import { I18nProvider } from '../i18n'
import type { WorkspaceAuthManager } from '../collab/workspaceAuth'
import type { Session } from '../session'
import { ReauthBanner } from './ReauthBanner'

// Signing in again with Google leaves the page. During a call or a file transfer the banner says what that ends
// before it goes. The workspace's call and transfer state is given as the provider gives it.

const session = { identityProvider: 'google', identityEmail: 'ada@example.com' } as Session
const authManager = { deviceKeyId: async () => 'P-256:xxxxxxxxxxxxxxxxxxxxxxxx:yyyyyyyyyyyyyyyyyyyyyyyy' } as unknown as WorkspaceAuthManager

function inWorkspace(children: ReactNode, { inCall = false, transfers = 0 } = {}) {
  return (
    <I18nProvider>
      <MediaContext.Provider value={{ inCall } as MediaSlice}>
        <ChatContext.Provider value={{ transfers: Array.from({ length: transfers }, (_, i) => ({ id: `f${i}`, name: 'a', percent: 5, direction: 'receive' })) } as unknown as ChatSlice}>
          {children}
        </ChatContext.Provider>
      </MediaContext.Provider>
    </I18nProvider>
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client.apps.googleusercontent.com')
  resetIdentityProviderCache()
  // jsdom cannot navigate; leaving for Google shows up as the page staying busy.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetIdentityProviderCache()
})

const banner = () => <ReauthBanner phase="expiring" session={session} authManager={authManager} onReauthed={() => {}} />

it('during a call, the first click says the call would end; the second goes', async () => {
  render(inWorkspace(banner(), { inCall: true }))
  fireEvent.click(screen.getByTestId('reauth-button'))
  expect(await screen.findByText('Signing in again reloads Peerly and ends your call.')).toBeTruthy()
  expect(screen.getByTestId('reauth-button').textContent).toBe('Sign in anyway')
  fireEvent.click(screen.getByTestId('reauth-button'))
  await vi.waitFor(() => expect(screen.getByTestId('reauth-button').textContent).toBe('Signing in…'))
})

it('during a file transfer, says the transfer would stop', async () => {
  render(inWorkspace(banner(), { transfers: 1 }))
  fireEvent.click(screen.getByTestId('reauth-button'))
  expect(await screen.findByText('Signing in again reloads Peerly and stops your file transfers.')).toBeTruthy()
})

it('with nothing under way, goes at once', async () => {
  render(inWorkspace(banner()))
  fireEvent.click(screen.getByTestId('reauth-button'))
  await vi.waitFor(() => expect(screen.getByTestId('reauth-button').textContent).toBe('Signing in…'))
})
