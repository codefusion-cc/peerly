/**
 * Keeps an open Peerly tab on the deployed build (@codefusion-cc/app-update):
 * each build publishes version.json with its commit, and a tab on an older one
 * reloads once nothing would be interrupted (never while a message is being
 * typed or sent). A tab whose scripts a deploy removed reloads into the new
 * build when it next loads a part of the app.
 */
import { watchAppUpdates } from '@codefusion-cc/app-update/browser'
import { BUILD } from './config.ts'

export const updates = watchAppUpdates({
  current: BUILD.commit,
  storageKey: 'peerly-update',
  // People leave a team chat open for hours: an idle tab moves to the new build without being left.
  reloadWhenIdle: true,
  checkEveryMs: 5 * 60_000,
})
