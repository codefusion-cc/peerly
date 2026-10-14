import { asDeviceKeyId, defineCommand, FrameError, isPlainObject } from '@codefusion-cc/realtime/protocol'

/**
 * `device.revoke`: the devices page signs one of the account's own devices
 * out. The account is the socket's own and never a parameter, so it can only
 * reach the caller's devices. The device's sessions end, its capabilities stop
 * holding, its sockets and channels close, and it can sign in again only with
 * a sign-in token issued after this.
 */
export const DEVICE_COMMANDS = [
  defineCommand('device.revoke', payload => {
    const deviceKeyId = isPlainObject(payload) ? asDeviceKeyId(payload.deviceKeyId) : null
    if (!deviceKeyId) throw new FrameError('malformed payload for device.revoke')
    return { deviceKeyId }
  }),
]

/** The device revocation part of the account gateway, for `combineGatewayApps`. */
export function deviceRevocationGateway() {
  return {
    commands: DEVICE_COMMANDS,
    handlers: ({ signOutDevice }) => ({
      'device.revoke': async payload => {
        await signOutDevice(payload.deviceKeyId)
        return { deviceKeyId: payload.deviceKeyId }
      },
    }),
  }
}
