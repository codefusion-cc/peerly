/**
 * Identifier types and minting for the control client and the signal scope.
 */

declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

/** `P-256:<x>:<y>` public key id of one device. */
export type DeviceKeyId = Brand<string, 'DeviceKeyId'>

const DEVICE_KEY_PATTERN = /^P-256:[A-Za-z0-9_-]{20,}:[A-Za-z0-9_-]{20,}$/

/**
 * Parsers, not casts. Each returns `null` rather than throwing so callers at
 * a trust boundary handle bad input explicitly instead of by exception.
 */
export function asDeviceKeyId(value: unknown): DeviceKeyId | null {
  return typeof value === 'string' && DEVICE_KEY_PATTERN.test(value) ? (value as DeviceKeyId) : null
}

/** Frame ids must be unique within an account, not merely within a tab. */
export interface IdSource {
  next(): string
}

const FRAME_ID_PATTERN = /^[\w-]{1,64}$/

/**
 * Per-client id source.
 *
 * The previous implementation minted `${Date.now().toString(36)}-${counter}`
 * with the counter starting at zero on every page load. The gateway keys its
 * idempotency table on that id, per account, for 24 hours — so two devices of
 * one account that loaded together and issued their n-th command in the same
 * millisecond produced the same id, and the second silently received the
 * first's cached ack instead of executing. The random prefix is what makes
 * the id unique per client rather than per millisecond.
 */
export function createIdSource(randomPrefix: () => string = defaultPrefix): IdSource {
  const prefix = randomPrefix()
  let counter = 0
  return {
    next() {
      counter += 1
      return `${prefix}-${counter.toString(36)}`
    },
  }
}

function defaultPrefix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function isValidFrameId(value: unknown): value is string {
  return typeof value === 'string' && FRAME_ID_PATTERN.test(value)
}
