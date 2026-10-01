/**
 * This account's devices and keys (`createLinkedDevices` from
 * @codefusion-cc/realtime): the first device makes the account key, later
 * ones are linked with a six-digit code. A linked device holds the account
 * key, which signs what only the account may change, such as the member list
 * of a workspace it owns.
 */
import {
  createAccountKeys, createKvStore, createLinkedDevices, describeDevice, sendRealtimeCommand, subscribeRealtimeEvent,
  type AccountSecrets, type StoredDevice,
} from '@codefusion-cc/realtime/browser'
import { APP_ID } from '../config.ts'
import { device } from '../auth/session.ts'

export const accountKeys = createAccountKeys(APP_ID)

export const linkedDevices = createLinkedDevices({
  keys: accountKeys,
  identity: device,
  command: (type, payload) => sendRealtimeCommand(APP_ID, type, payload),
  store: createKvStore<StoredDevice>(`${APP_ID}-devices`, 'devices'),
  deviceName: () => describeDevice(navigator.userAgent, navigator.maxTouchPoints > 0) ?? 'Browser',
  lock: (name, work) => navigator.locks ? navigator.locks.request(name, work) : work(),
})

/** Keeps this device's view of the account's devices current; returns the stop function. */
export function followDevices(userId: string): () => void {
  void linkedDevices.sync(userId).catch(() => {})
  return subscribeRealtimeEvent(APP_ID, 'account.devices', event => {
    const revision = (event as CustomEvent<{ revision?: number }>).detail?.revision
    void linkedDevices.sync(userId, typeof revision === 'number' ? revision : undefined).catch(() => {})
  })
}

/** The account's secrets on this device: null until it is linked (a second device asks a linked one first). */
export const accountSecrets = (userId: string): Promise<AccountSecrets | null> => linkedDevices.secrets(userId)
