import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { FileRef } from '../content/ops.ts'
import type { FileState, WorkspaceFiles } from './workspaceFiles.ts'

/** Images this small come by themselves when shown; anything larger waits to be asked for. */
const AUTO_LOAD_BYTES = 10 * 1024 * 1024

/** Where a file stands on this device, re-rendered as it changes; images up to 10 MB load by themselves. */
export function useFile(files: WorkspaceFiles, ref: FileRef, image: boolean): FileState {
  const subscribe = useCallback((listener: () => void) => files.subscribe(ref.hash, listener), [files, ref.hash])
  const state = useSyncExternalStore(subscribe, () => files.state(ref.hash))
  useEffect(() => {
    if (state.status === 'idle' && image && ref.size <= AUTO_LOAD_BYTES) void files.load(ref)
  }, [files, ref, image, state.status])
  return state
}
