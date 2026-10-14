/**
 * The realtime wire contract: limits, identifiers, frames, and the command
 * registry. Pure — no platform globals beyond `crypto` and `TextEncoder` — so
 * it is imported unchanged by the browser client and the Worker, and every
 * rule in it is unit testable without a Durable Object or a socket.
 */
export { CLIENT_TIMINGS, LIMITS, type Limits } from './limits.js'
export {
  asDeviceKeyId, createIdSource, isValidFrameId,
  type DeviceKeyId, type IdSource,
} from './ids.js'
export {
  boundedString, byteLength, CLOSE, decodeFrame, encodeError, encodeFrame, FrameError,
  isPlainObject, parseEnvelope,
  type CloseCode, type Envelope, type ErrorCode,
} from './frames.js'
export {
  defineCommand, signalCommand, SCOPE_KINDS,
  type CommandSpec, type ScopeKind, type SignalPayload,
} from './commands.js'
