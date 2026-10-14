import { describe, expect, it } from 'vitest'
import { createBucket, take } from './index.js'

const policy = { burst: 3, sustainedPerSecond: 1 }

describe('token bucket', () => {
  it('allows a burst then refuses', () => {
    let bucket = createBucket(policy, 0)
    for (let i = 0; i < 3; i += 1) {
      const result = take(bucket, policy, 0)
      expect(result.allowed).toBe(true)
      bucket = result.bucket
    }
    expect(take(bucket, policy, 0).allowed).toBe(false)
  })

  it('refills at the sustained rate and never past the burst ceiling', () => {
    let bucket = createBucket(policy, 0)
    for (let i = 0; i < 3; i += 1) bucket = take(bucket, policy, 0).bucket
    expect(take(bucket, policy, 1_000).allowed).toBe(true)

    const idle = take(createBucket(policy, 0), policy, 3_600_000)
    expect(idle.bucket.tokens).toBeCloseTo(policy.burst - 1)
  })

  it('mints nothing when the clock goes backwards', () => {
    let bucket = createBucket(policy, 10_000)
    for (let i = 0; i < 3; i += 1) bucket = take(bucket, policy, 10_000).bucket
    expect(take(bucket, policy, 0).allowed).toBe(false)
  })

  it('reports how long until a token is available', () => {
    let bucket = createBucket(policy, 0)
    for (let i = 0; i < 3; i += 1) bucket = take(bucket, policy, 0).bucket
    expect(take(bucket, policy, 0).retryAfterMs).toBe(1_000)
  })
})
