import { fileURLToPath } from 'url'
import { buildIdentity } from '@codefusion-cc/console/vite'

/**
 * Build identity injected into the bundle as compile-time constants.
 *
 * Shared by vite.config.ts and vitest.config.ts on purpose: vitest does not read
 * vite.config.ts, so without this the app builds fine and every test that
 * imports config.ts dies on `__APP_VERSION__ is not defined`. Duplicating the
 * values in both configs would just let them drift instead.
 *
 * The commit is the one CI names (a pull request's own head, not GitHub's merge
 * commit), else git's HEAD, else `unknown`. `versionFile()` in vite.config.ts
 * serves the same identity as /version.json for CodeFusion Console.
 */
export function buildDefines() {
  const { version, commit } = buildIdentity(fileURLToPath(new URL('.', import.meta.url)))
  return {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
  }
}
