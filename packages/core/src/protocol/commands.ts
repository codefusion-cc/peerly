/**
 * The commands Peerly's own realtime code still validates: the frame a
 * signal socket accepts, and the scope kinds a page may ask the account
 * gateway for. The gateway's command registry is `@codefusion-cc/realtime`'s.
 */
import { LIMITS } from './limits.js'
import { boundedArray, boundedString, FrameError, isPlainObject } from './frames.js'

/**
 * `validate` returns the parsed payload or throws `FrameError`. Returning a
 * *typed* value rather than a boolean is what lets a handler receive
 * `SeekRequest` instead of `unknown` and stop re-checking what the validator
 * already proved.
 */
export type CommandSpec<Payload> = {
  readonly type: string
  validate(payload: unknown): Payload
}

export function defineCommand<Payload>(
  type: string,
  validate: (payload: unknown) => Payload
): CommandSpec<Payload> {
  return { type, validate }
}

/**
 * A function declaration, not an arrow constant: TypeScript only narrows past
 * a call when the callee's `never` return is visible at the call site, which
 * it is for a declaration and is not for a `const` without an explicit type.
 * That difference is what lets the validators below read a field once and have
 * it narrowed for the return.
 */
function fail(type: string): never {
  throw new FrameError(`malformed payload for ${type}`)
}

export const SCOPE_KINDS = ['workspace', 'dm', 'room', 'chat'] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]

// ---- signal socket ---------------------------------------------------------

export type SignalPayload = {
  topic?: string
  to?: string
  subscribe?: string[]
  message?: unknown
}

/**
 * The one frame a signal socket accepts. The scope forwards `message`
 * opaquely and reads only routing fields, so this validates the envelope
 * around the payload and never the SDP/ICE inside it.
 */
export const signalCommand = defineCommand<SignalPayload>('signal', payload => {
  if (!isPlainObject(payload)) fail('signal')
  const value = payload as Record<string, unknown>
  if (value.to !== undefined && !boundedString(value.to, 128)) fail('signal')
  if (value.topic !== undefined && !boundedString(value.topic, 256)) fail('signal')
  if (value.subscribe !== undefined &&
    !boundedArray(value.subscribe, LIMITS.topicsPerParticipant, (entry): entry is string =>
      boundedString(entry, 256))) fail('signal')
  return value as SignalPayload
})
