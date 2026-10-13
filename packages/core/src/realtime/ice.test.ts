import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CLOUDFLARE_STUN, hasRelay } from '@codefusion-cc/realtime-media/ice'
import { ICE_EXPIRY_MARGIN_MS, parseIceGrant, usableIceServers, type IceGrant } from './ice'

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const STUN = { urls: [...CLOUDFLARE_STUN.urls] }
const TURN = {
  urls: [
    'turn:turn.cloudflare.com:3478?transport=udp',
    'turn:turn.cloudflare.com:3478?transport=tcp',
    'turns:turn.cloudflare.com:5349?transport=tcp',
  ],
  username: 'user',
  credential: 'credential',
}
/** What the Worker sends when the deployment has a TURN key. */
const session = (extra: Record<string, unknown> = {}) => ({ servers: [STUN, TURN], ttlMs: HOUR, ...extra })

describe('parseIceGrant', () => {
  it('accepts what the Worker sends with a TURN key', () => {
    expect(parseIceGrant(session(), NOW)).toEqual({ servers: [STUN, TURN], expiresAt: NOW + HOUR })
  })

  it('measures the lifetime on this device\'s clock, however far it is from the server\'s', () => {
    const hoursAhead = NOW + 5 * HOUR
    expect(parseIceGrant(session(), hoursAhead)?.expiresAt).toBe(hoursAhead + HOUR)
    expect(parseIceGrant(session(), 0)?.expiresAt).toBe(HOUR)
  })

  it('accepts what the Worker sends without one: STUN, no expiry', () => {
    expect(parseIceGrant({ servers: [STUN] }, NOW)).toEqual({ servers: [STUN] })
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['no servers', { ttlMs: HOUR }],
    ['an empty list', { servers: [] }],
    ['someone else\'s TURN server', { servers: [STUN, { ...TURN, urls: ['turn:relay.peerly.cc:3478?transport=udp'] }], ttlMs: HOUR }],
    ['TURN without a credential', { servers: [STUN, { ...TURN, credential: undefined }], ttlMs: HOUR }],
  ])('rejects %s, by the ICE server rules every CodeFusion app shares', (_, value) => {
    expect(parseIceGrant(value, NOW)).toBeNull()
  })

  it.each([
    ['no lifetime', undefined],
    ['a lifetime as text', String(HOUR)],
    ['a lifetime that is not a number', Number.NaN],
    ['a lifetime of infinity', Number.POSITIVE_INFINITY],
    ['credentials that expire now', 0],
    ['credentials that already expired', -1],
    ['credentials that outlive a day', 86_400_001],
  ])('rejects TURN with %s', (_, ttlMs) => {
    expect(parseIceGrant(session({ ttlMs }), NOW)).toBeNull()
  })

  it('accepts TURN that expires one millisecond from now, or in a day', () => {
    expect(parseIceGrant(session({ ttlMs: 1 }), NOW)?.expiresAt).toBe(NOW + 1)
    expect(parseIceGrant(session({ ttlMs: 86_400_000 }), NOW)?.expiresAt).toBe(NOW + 86_400_000)
  })

  it('rejects a lifetime on STUN alone, which has nothing to expire', () => {
    expect(parseIceGrant({ servers: [STUN], ttlMs: HOUR }, NOW)).toBeNull()
  })

  it('never throws, whatever arrives', () => {
    fc.assert(fc.property(fc.anything(), value => {
      const grant = parseIceGrant(value, NOW)
      expect(grant === null || Array.isArray(grant.servers)).toBe(true)
    }))
  })

  it('gives back a valid grant\'s servers unchanged, expiring a lifetime from now, and sending it again changes nothing', () => {
    const url = fc.constantFrom(
      CLOUDFLARE_STUN.urls[0],
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turn:turn.cloudflare.com:80?transport=tcp',
      'turns:turn.cloudflare.com:443?transport=tcp',
    )
    const secret = fc.string({ minLength: 1, maxLength: 64 })
    const server = fc.record({ urls: fc.array(url, { minLength: 1, maxLength: 8 }), username: secret, credential: secret })
    fc.assert(fc.property(
      fc.array(server, { minLength: 1, maxLength: 8 }),
      fc.integer({ min: 1, max: 10 * HOUR }),
      (raw, lifetime) => {
        const servers = raw.map(entry => entry.urls.some(u => u.startsWith('turn'))
          ? entry
          : { urls: entry.urls })
        const relayed = hasRelay(servers)
        const grant = parseIceGrant(relayed ? { servers, ttlMs: lifetime } : { servers }, NOW)
        expect(grant).toEqual(relayed ? { servers, expiresAt: NOW + lifetime } : { servers })
        const resent = grant?.expiresAt === undefined
          ? { servers: grant?.servers }
          : { servers: grant.servers, ttlMs: grant.expiresAt - NOW }
        expect(parseIceGrant(resent, NOW)).toEqual(grant)
      },
    ))
  })
})

describe('usableIceServers', () => {
  const grant = parseIceGrant(session(), NOW) as IceGrant
  const lastFreshMoment = NOW + HOUR - ICE_EXPIRY_MARGIN_MS - 1

  it('is Cloudflare STUN before the session has answered', () => {
    expect(usableIceServers(undefined, NOW)).toEqual([STUN])
  })

  it('hands out TURN until a minute before the credentials expire', () => {
    expect(usableIceServers(grant, NOW)).toEqual([STUN, TURN])
    expect(usableIceServers(grant, lastFreshMoment)).toEqual([STUN, TURN])
  })

  it('drops TURN from a minute before expiry on, keeping STUN', () => {
    expect(usableIceServers(grant, lastFreshMoment + 1)).toEqual([STUN])
    expect(usableIceServers(grant, NOW + 5 * HOUR)).toEqual([STUN])
  })

  it('falls back to Cloudflare STUN when an expired grant had TURN alone', () => {
    const turnOnly = parseIceGrant(session({ servers: [TURN] }), NOW) as IceGrant
    expect(usableIceServers(turnOnly, NOW + HOUR)).toEqual([STUN])
  })

  it('keeps STUN alone forever', () => {
    const stunOnly = parseIceGrant({ servers: [STUN] }, NOW) as IceGrant
    expect(usableIceServers(stunOnly, Number.MAX_SAFE_INTEGER)).toEqual([STUN])
  })

  it('hands out copies, so a peer connection cannot change the next one\'s servers', () => {
    const first = usableIceServers(grant, NOW)
    first[1].urls.push('turn:attacker.example')
    first[1].username = 'changed'
    expect(usableIceServers(grant, NOW)).toEqual([STUN, TURN])
    usableIceServers(undefined, NOW)[0].urls.push('x')
    expect(usableIceServers(undefined, NOW)).toEqual([STUN])
  })

  it('never hands out TURN that expires within the minute, at any moment', () => {
    fc.assert(fc.property(fc.integer({ min: NOW - HOUR, max: NOW + 2 * HOUR }), now => {
      const relayed = hasRelay(usableIceServers(grant, now))
      expect(relayed).toBe(now < (grant.expiresAt as number) - ICE_EXPIRY_MARGIN_MS)
    }))
  })
})
