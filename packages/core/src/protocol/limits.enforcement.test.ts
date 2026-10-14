import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS as PACKAGE_LIMITS } from '@codefusion-cc/realtime/protocol'
import { CLIENT_TIMINGS, LIMITS } from './limits.js'

/**
 * The guard `limits.ts` has always claimed to have.
 *
 * Its header says "adding a limit here is not enough: `limits.enforcement.test.ts`
 * fails for any key with no test proving it is enforced somewhere". That file did
 * not exist, which is exactly why the delta-batching trio shipped declared and
 * unread for a release, and why `signalSocketsPerDevice` and `attachmentBytes`
 * before them did the same.
 *
 * Two things are checked, and the second is the one that matters:
 *
 * 1. Every key is named in the registry below, so adding a constant forces a
 *    human to say where it is enforced.
 * 2. The file named in the registry actually reads the key, so a claim cannot
 *    go stale after the enforcement moves or is deleted. A registry nobody
 *    verifies is a comment.
 */

const here = dirname(fileURLToPath(import.meta.url))
const coreRoot = join(here, '..', '..')

/** key -> the file that reads it. */
const ENFORCED_IN: Record<string, string> = {
  protocolVersion: 'src/protocol/frames.ts',
  signalFrameBytes: 'src/adapters/durableObject/signalScopeRuntime.ts',
  attachmentBytes: 'src/domain/signalRouting.ts',
  participantsPerScope: 'src/adapters/durableObject/signalScopeRuntime.ts',
  topicsPerParticipant: 'src/domain/signalRouting.ts',
  signalsBurst: 'src/adapters/durableObject/signalScopeRuntime.ts',
  signalsSustained: 'src/adapters/durableObject/signalScopeRuntime.ts',
  directoryWatchTtlMs: 'src/coordination.ts',
  cookieTtlMs: 'src/protocol/limits.ts',
}

/** Client pacing is enforced by the client alone. */
const CLIENT_ENFORCED_IN: Record<string, string> = {
  sessionRefreshMs: 'src/app/realtimeClient.ts',
  pingIntervalMs: 'src/app/realtimeClient.ts',
  commandTimeoutMs: 'src/app/realtimeClient.ts',
  commandQueueMax: 'src/app/realtimeClient.ts',
  reconnectBaseMs: 'src/app/realtimeClient.ts',
  reconnectCapMs: 'src/app/realtimeClient.ts',
  resumeSaveDebounceMs: 'src/app/realtimeClient.ts',
}

const read = (relativePath: string): string => readFileSync(join(coreRoot, relativePath), 'utf8')

describe('every declared limit is enforced somewhere', () => {
  it('names an enforcement site for every LIMITS key', () => {
    const declared = Object.keys(LIMITS).sort()
    const registered = Object.keys(ENFORCED_IN).sort()
    // A key added to `limits.ts` without a line here fails, which is the whole
    // point: the registry is the forcing function.
    expect(registered).toEqual(declared)
  })

  it('names an enforcement site for every CLIENT_TIMINGS key', () => {
    expect(Object.keys(CLIENT_ENFORCED_IN).sort()).toEqual(Object.keys(CLIENT_TIMINGS).sort())
  })

  it.each(Object.entries(ENFORCED_IN))('LIMITS.%s is actually read by its named file', (key, file) => {
    expect(read(file)).toContain(key)
  })

  it.each(Object.entries(CLIENT_ENFORCED_IN))(
    'CLIENT_TIMINGS.%s is actually read by its named file',
    (key, file) => {
      expect(read(file)).toContain(key)
    }
  )
})

describe('the control client keeps pace with the package Worker', () => {
  it('refreshes inside the cookie lifetime the Worker issues', () => {
    expect(LIMITS.cookieTtlMs).toBe(PACKAGE_LIMITS.cookieTtlMs)
    expect(CLIENT_TIMINGS.sessionRefreshMs).toBeLessThan(PACKAGE_LIMITS.cookieTtlMs / 2)
  })

  it('speaks the protocol version the Worker speaks', () => {
    expect(LIMITS.protocolVersion).toBe(PACKAGE_LIMITS.protocolVersion)
  })
})
