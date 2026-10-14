/**
 * The caps Peerly's own realtime code still enforces: the signal scopes that
 * carry Trystero's signaling, and the control client's pacing. The control
 * plane's server caps are `@codefusion-cc/realtime`'s `LIMITS`; `cookieTtlMs`
 * mirrors its cookie lifetime, which the client's refresh must stay inside
 * (`limits.enforcement.test.ts` checks the two agree).
 *
 * Adding a limit here is not enough: `limits.enforcement.test.ts` names the
 * file that enforces every key and fails when that file stops reading it, so a
 * cap cannot quietly become decoration.
 */
export const LIMITS = {
  protocolVersion: 1,

  signalFrameBytes: 16 * 1024,
  /** Hard runtime cap on a serialized WebSocket attachment. Exceeding it
   *  throws inside the message handler, which loses the socket. */
  attachmentBytes: 2048,

  participantsPerScope: 16,
  /** Topics one signal participant may claim for routed delivery. */
  topicsPerParticipant: 8,

  signalsBurst: 50,
  signalsSustained: 20,

  /**
   * How long a directory watch survives without renewal.
   *
   * Watches replace the 30-second `directory.list` poll, which was the largest
   * per-tab cost in the system. A lease rather than a subscription because the
   * shard cannot observe a browser tab closing: an abandoned watch has to stop
   * costing on its own.
   */
  directoryWatchTtlMs: 15 * 60_000,

  /** The network cookie's lifetime, so a client must refresh well inside it. */
  cookieTtlMs: 30 * 60_000,
} as const

export type Limits = typeof LIMITS

/** Client-side pacing, derived from the server caps above rather than guessed.
 *  Both sessions and TURN credentials expire at `cookieTtlMs`; refreshing at a
 *  third of that survives two consecutive failures. */
export const CLIENT_TIMINGS = {
  sessionRefreshMs: Math.floor(LIMITS.cookieTtlMs / 3),
  pingIntervalMs: 45_000,
  commandTimeoutMs: 15_000,
  commandQueueMax: 100,
  reconnectBaseMs: 250,
  reconnectCapMs: 30_000,
  resumeSaveDebounceMs: 2_000,
} as const
