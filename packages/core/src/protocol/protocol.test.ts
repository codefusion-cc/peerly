import { describe, expect, it } from 'vitest'
import {
  CLOSE, createIdSource, encodeError, FrameError, LIMITS, parseEnvelope,
} from './index.js'
import { asDeviceKeyId } from './ids.js'

const frame = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, id: 'cmd-1', type: 'hello', sentAt: Date.now(), ...overrides })

describe('envelope parsing', () => {
  it('accepts a well-formed envelope and drops unknown top-level fields', () => {
    const parsed = parseEnvelope(frame({ nonsense: 'ignored' }), LIMITS.signalFrameBytes)
    expect(parsed.type).toBe('hello')
    expect('nonsense' in parsed).toBe(false)
  })

  it('closes 4002 on a version mismatch, not 4003', () => {
    // The client's terminal "upgrade required" state is reachable only via
    // 4002; reporting a version mismatch as a generic malformed frame left
    // that path dead.
    try {
      parseEnvelope(frame({ v: 2 }), LIMITS.signalFrameBytes)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as FrameError).close).toBe(CLOSE.VERSION_UNSUPPORTED)
      expect((error as FrameError).code).toBe('version-unsupported')
    }
  })

  it.each([
    ['binary', new Uint8Array([1, 2, 3]), CLOSE.MALFORMED_FRAME],
    ['non-json', 'not json at all', CLOSE.MALFORMED_FRAME],
    ['array envelope', '[]', CLOSE.MALFORMED_FRAME],
  ])('closes on %s', (_label, message, expected) => {
    try {
      parseEnvelope(message, LIMITS.signalFrameBytes)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as FrameError).close).toBe(expected)
    }
  })

  it('rejects an oversized frame by bytes, not just by length', () => {
    // Multi-byte characters make UTF-16 length an under-estimate; a frame can
    // pass the cheap check and still exceed the byte cap.
    const padding = '✓'.repeat(LIMITS.signalFrameBytes)
    try {
      parseEnvelope(frame({ payload: { padding } }), LIMITS.signalFrameBytes)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as FrameError).close).toBe(CLOSE.FRAME_TOO_LARGE)
    }
  })

  it('rejects a frame id outside the id pattern', () => {
    expect(() => parseEnvelope(frame({ id: 'has spaces' }), LIMITS.signalFrameBytes)).toThrow(FrameError)
  })
})

describe('frame ids', () => {
  it('does not collide between two clients started in the same millisecond', () => {
    // The previous format was `${Date.now().toString(36)}-${counter}` with the
    // counter reset per page load, so two devices of one account produced
    // identical ids — and the second silently received the first's cached ack
    // from the gateway's idempotency table.
    const a = createIdSource()
    const b = createIdSource()
    const first = new Set(Array.from({ length: 500 }, () => a.next()))
    const second = new Set(Array.from({ length: 500 }, () => b.next()))
    expect(first.size).toBe(500)
    expect([...second].some(id => first.has(id))).toBe(false)
  })
})

describe('identifier parsers', () => {
  it('parses a well-formed device key id and rejects a malformed one', () => {
    const valid = `P-256:${'a'.repeat(43)}:${'b'.repeat(43)}`
    expect(asDeviceKeyId(valid)).toBe(valid)
    expect(asDeviceKeyId('P-256:short:short')).toBeNull()
    expect(asDeviceKeyId(42)).toBeNull()
  })
})

describe('response frames', () => {
  it('marks a retryable error with its retry hint', () => {
    const payload = JSON.parse(encodeError('rate-limited', { forId: 'c1', retryable: true, retryAfterMs: 1000 }))
    expect(payload.payload).toMatchObject({ for: 'c1', code: 'rate-limited', retryable: true, retryAfterMs: 1000 })
  })
})
