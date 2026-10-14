/**
 * Keeps an open Peerly tab on the deployed build (@codefusion-cc/app-update): each build publishes version.json with
 * its commit, and a tab on an older one reloads as soon as nothing would be interrupted: never during a call or a file
 * transfer (their hooks hold it), a changed field or a request that changes data. A tab whose scripts a deploy
 * removed reloads into the new build (lazyPage).
 */
import { lazy, useEffect, useState, type ComponentType } from 'react'
import { watchAppUpdates } from '@codefusion-cc/app-update/browser'

export const updates = watchAppUpdates({
  current: __APP_COMMIT__,
  storageKey: 'peerly-update',
  // People leave Peerly open for days: an idle tab moves to the new build without waiting to be left, and a
  // background one does so unseen.
  reloadWhenIdle: true,
  checkEveryMs: 5 * 60_000,
})

/** A transfer without progress for this long no longer holds the reload: its peer left, or its send failed. */
export const TRANSFER_STALL_MS = 60_000

/** Holds the reload while `active`, e.g. during a call. */
export function useUpdateHold(active: boolean): void {
  useEffect(() => (active ? updates.hold() : undefined), [active])
}

/** Holds the reload while files move: from each step of progress until a minute without any. */
export function useTransferHold(transfers: readonly { id: string; percent: number }[]): void {
  const progress = transfers.map(transfer => `${transfer.id}:${transfer.percent}`).join()
  const [stalledAt, setStalledAt] = useState<string | null>(null)
  useEffect(() => {
    if (!progress) return undefined
    const timer = setTimeout(() => setStalledAt(progress), TRANSFER_STALL_MS)
    return () => clearTimeout(timer)
  }, [progress])
  useUpdateHold(progress !== '' && progress !== stalledAt)
}

/**
 * A lazily loaded page. A chunk that fails to load means a deploy replaced the assets this tab refers to, so the tab
 * reloads into the new build and keeps showing the loading state; a second failure soon after reaches the error
 * boundary instead of looping.
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async () => ({ default: await updates.importOrReload(load) }))
}
