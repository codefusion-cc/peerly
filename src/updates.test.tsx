// @vitest-environment jsdom
import { testPage, type TestPage } from '@codefusion-cc/app-update/testing'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './components/ErrorBoundary'

// src/updates.ts with the real @codefusion-cc/app-update behind it; only the page's edges are made up (its address,
// the tab's storage, Web Locks, the deploy's version file). How a reload is held and kept from looping is the
// package's, and tested there; what is Peerly's is when it holds and what a person sees.

const NEWER = 'b'.repeat(40)
let page: TestPage
let stop = () => {}

/** A fresh document's modules, its page deployed at `deployed`. */
async function freshDocument(deployed: string | null = null) {
  vi.resetModules()
  page = testPage({ deployed })
  vi.doMock('@codefusion-cc/app-update/browser', async original => {
    const module = await original<typeof import('@codefusion-cc/app-update/browser')>()
    return { ...module, watchAppUpdates: (options: Parameters<typeof module.watchAppUpdates>[0]) => module.watchAppUpdates(options, page.env) }
  })
  const modules = await import('./updates')
  const { UpdateNotice } = await import('./components/UpdateNotice')
  const { I18nProvider } = await import('./i18n')
  stop = modules.updates.stop
  await act(() => page.settle())
  return { ...modules, UpdateNotice, I18nProvider }
}

/** A newer build is deployed and the page hears of it (the person comes back to it). */
async function deploy() {
  page.deployed = NEWER
  await act(() => page.comeBack())
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => {
  cleanup()
  stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.doUnmock('@codefusion-cc/app-update/browser')
})

it('an idle tab moves to a newer build by itself', async () => {
  await freshDocument(NEWER)
  expect(page.reloads).toBe(1)
})

it('a tab on the deployed build stays', async () => {
  await freshDocument(__APP_COMMIT__)
  await act(() => page.comeBack())
  expect(page.reloads).toBe(0)
})

it('a call holds the tab on its build and offers the newer one; ending it moves over', async () => {
  const { useUpdateHold, UpdateNotice, I18nProvider } = await freshDocument()
  function Call({ inCall }: { inCall: boolean }) {
    useUpdateHold(inCall)
    return null
  }
  const view = render(<I18nProvider><Call inCall /><UpdateNotice /></I18nProvider>)
  await deploy()
  expect(page.reloads).toBe(0)
  expect(screen.getByRole('status').textContent).toContain('A new version of Peerly is ready.')

  view.rerender(<I18nProvider><Call inCall={false} /><UpdateNotice /></I18nProvider>)
  await act(() => page.settle())
  expect(page.reloads).toBe(1)
})

it('Later hides the offer, and Refresh reloads at once even during a call', async () => {
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  const { useUpdateHold, UpdateNotice, I18nProvider } = await freshDocument()
  function Call() {
    useUpdateHold(true)
    return null
  }
  const view = render(<I18nProvider><Call /><UpdateNotice /></I18nProvider>)
  await deploy()
  fireEvent.click(screen.getByRole('button', { name: 'Later' }))
  expect(screen.queryByTestId('update-notice')).toBeNull()
  view.unmount()

  render(<I18nProvider><Call /><UpdateNotice /></I18nProvider>)
  await deploy()
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
  expect(reload).toHaveBeenCalledTimes(1)
  vi.unstubAllGlobals()
})

it('a moving transfer holds the tab; one stalled for a minute lets it go', async () => {
  // The page's own waits still run in real time; the stall is counted on the fake clock.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const { useTransferHold, TRANSFER_STALL_MS } = await freshDocument()
  function Files({ percent }: { percent: number }) {
    useTransferHold([{ id: 'file-1', percent }])
    return null
  }
  const view = render(<Files percent={10} />)
  await deploy()
  expect(page.reloads).toBe(0)

  // Progress keeps it held past the first minute.
  await act(() => vi.advanceTimersByTimeAsync(TRANSFER_STALL_MS - 1_000))
  view.rerender(<Files percent={60} />)
  await act(() => vi.advanceTimersByTimeAsync(TRANSFER_STALL_MS - 1_000))
  expect(page.reloads).toBe(0)

  // Then nothing more arrives: the peer left.
  await act(() => vi.advanceTimersByTimeAsync(1_000 + 30_000))
  expect(page.reloads).toBe(1)
})

it('a finished transfer lets the tab move over', async () => {
  const { useTransferHold } = await freshDocument()
  function Files({ done }: { done: boolean }) {
    useTransferHold(done ? [] : [{ id: 'file-1', percent: 99 }])
    return null
  }
  const view = render(<Files done={false} />)
  await deploy()
  expect(page.reloads).toBe(0)
  view.rerender(<Files done />)
  await act(() => page.settle())
  expect(page.reloads).toBe(1)
})

it('a page whose chunk a deploy removed reloads into the new build instead of showing an error', async () => {
  const { lazyPage } = await freshDocument()
  const Missing = lazyPage(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))
  render(<ErrorBoundary><Suspense fallback={<p>Loading</p>}><Missing /></Suspense></ErrorBoundary>)
  await vi.waitFor(() => expect(page.reloads).toBe(1))
  expect(screen.getByText('Loading')).toBeTruthy()
})

it('a lazy page renders when its chunk loads', async () => {
  const { lazyPage } = await freshDocument()
  const Present = lazyPage(async () => () => <p>Devices</p>)
  render(<Suspense fallback={<p>Loading</p>}><Present /></Suspense>)
  expect(await screen.findByText('Devices')).toBeTruthy()
})
