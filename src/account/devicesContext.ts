import type { DevicesState } from '@codefusion-cc/realtime/browser'
import type { LinkedDevicesActions } from '@codefusion-cc/realtime/react'
import { createContext, useContext } from 'react'

export type Devices = {
  state: DevicesState | null
  actions: LinkedDevicesActions
  /** Opens the dialog that links this device, asking the linked ones as it opens. */
  openLink(): void
  /** Brings a request put off with "Later" back to the approval dialog. */
  review(requestId: string): void
}

export const DevicesContext = createContext<Devices | null>(null)

/** The account's devices, for any signed-in screen (inside `DevicesProvider`). */
export function useDevices(): Devices {
  const value = useContext(DevicesContext)
  if (!value) throw new Error('useDevices must be used inside <DevicesProvider>')
  return value
}
