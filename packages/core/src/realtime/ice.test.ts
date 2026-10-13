import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CLOUDFLARE_STUN_URL,
  hasTurn,
  ICE_EXPIRY_MARGIN_MS,
  parseIceGrant,
  usableIceServers,
  type IceGrant,
} from './ice'

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const STUN = { urls: [CLOUDFLARE_STUN_URL] }
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
const session = (extra: Record<string, unknown> = {}) => ({ servers: [STUN, TURN], expiresAt: NOW + HOUR, ...extra })

describe('parseIceGrant', () => {
  it('accepts what the Worker sends with a TURN key', () => {
    expect(parseIceGrant(session(), NOW)).toEqual({ servers: [STUN, TURN], expiresAt: NOW + HOUR })
  })

  it('accepts what the Worker sends without one: STUN, no expiry', () => {
    expect(parseIceGrant({ servers: [STUN] }, NOW)).toEqual({ servers: [STUN] })
  })

  it('accepts every port Cloudflare publishes, and a single url given as a string', () => {
    const urls = [
      'turn:turn.cloudflare.com:80?transport=tcp',
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turns:turn.cloudflare.com:443?transport=tcp',
      'turns:turn.cloudflare.com:5349?transport=tcp',
    ]
    expect(parseIceGrant(session({ servers: [{ ...TURN, urls }] }), NOW)?.servers[0].urls).toEqual(urls)
    expect(parseIceGrant({ servers: [{ urls: CLOUDFLARE_STUN_URL }] }, NOW)).toEqual({ servers: [STUN] })
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'stun:stun.cloudflare.com:3478'],
    ['no servers', { expiresAt: NOW + HOUR }],
    ['an empty list', { servers: [] }],
    ['servers that are not a list', { servers: STUN }],
    ['a server that is not an object', { servers: [STUN, 'turn:turn.cloudflare.com'] }],
    ['a server with no urls', { servers: [{ urls: [] }] }],
  ])('rejects %s', (_, value) => {
    expect(parseIceGrant(value, NOW)).toBeNull()
  })

  it.each([
    ['someone else\'s TURN server', 'turn:relay.peerly.cc:3478?transport=udp'],
    ['someone else\'s STUN server', 'stun:stun.l.google.com:19302'],
    ['a look-alike host', 'turn:turn.cloudflare.com.evil.example:3478?transport=udp'],
    ['an unpublished port', 'turn:turn.cloudflare.com:3479?transport=udp'],
    ['TURNS over UDP', 'turns:turn.cloudflare.com:5349?transport=udp'],
    ['a trailing parameter', 'turn:turn.cloudflare.com:3478?transport=udp&x=1'],
    ['a line break', 'turn:turn.cloudflare.com:3478?transport=udp\n'],
    ['upper case', 'TURN:TURN.CLOUDFLARE.COM:3478?transport=udp'],
    ['a number', 3478],
  ])('rejects the whole grant over one url pointing at %s', (_, url) => {
    const servers = [STUN, { ...TURN, urls: [...TURN.urls, url] }]
    expect(parseIceGrant(session({ servers }), NOW)).toBeNull()
  })

  it.each([
    ['no username', { username: undefined }],
    ['no credential', { credential: undefined }],
    ['an empty credential', { credential: '' }],
    ['a credential that is not text', { credential: { secret: 'x' } }],
    ['a credential longer than 2048 characters', { credential: 'x'.repeat(2049) }],
  ])('rejects TURN with %s', (_, change) => {
    expect(parseIceGrant(session({ servers: [{ ...TURN, ...change }] }), NOW)).toBeNull()
  })

  it('takes credentials up to 2048 characters, unicode included', () => {
    const credential = 'ł'.repeat(2048)
    expect(parseIceGrant(session({ servers: [{ ...TURN, credential }] }), NOW)?.servers[0].credential).toBe(credential)
  })

  it('takes up to 8 servers of up to 8 urls, and refuses one more of either', () => {
    expect(parseIceGrant({ servers: Array(8).fill(STUN) }, NOW)?.servers).toHaveLength(8)
    expect(parseIceGrant({ servers: Array(9).fill(STUN) }, NOW)).toBeNull()
    expect(parseIceGrant({ servers: [{ urls: Array(8).fill(CLOUDFLARE_STUN_URL) }] }, NOW)).not.toBeNull()
    expect(parseIceGrant({ servers: [{ urls: Array(9).fill(CLOUDFLARE_STUN_URL) }] }, NOW)).toBeNull()
  })

  it.each([
    ['no expiry', undefined],
    ['an expiry as text', String(NOW + HOUR)],
    ['an expiry that is not a number', Number.NaN],
    ['an expiry at infinity', Number.POSITIVE_INFINITY],
    ['credentials that expire now', NOW],
    ['credentials that already expired', NOW - 1],
  ])('rejects TURN with %s', (_, expiresAt) => {
    expect(parseIceGrant(session({ expiresAt }), NOW)).toBeNull()
  })

  it('accepts TURN that expires one millisecond from now', () => {
    expect(parseIceGrant(session({ expiresAt: NOW + 1 }), NOW)?.expiresAt).toBe(NOW + 1)
  })

  it('rejects an expiry on STUN alone, which has nothing to expire', () => {
    expect(parseIceGrant({ servers: [STUN], expiresAt: NOW + HOUR }, NOW)).toBeNull()
  })

  it('drops anything else the server adds to a server entry', () => {
    const grant = parseIceGrant(session({ servers: [{ ...TURN, credentialType: 'oauth', extra: 1 }] }), NOW)
    expect(grant?.servers[0]).toEqual(TURN)
  })

  it('never throws, whatever arrives', () => {
    fc.assert(fc.property(fc.anything(), value => {
      const grant = parseIceGrant(value, NOW)
      expect(grant === null || Array.isArray(grant.servers)).toBe(true)
    }))
  })

  it('gives back a valid grant unchanged, and parsing its own output again changes nothing', () => {
    const url = fc.constantFrom(
      CLOUDFLARE_STUN_URL,
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
        const value = hasTurn(servers) ? { servers, expiresAt: NOW + lifetime } : { servers }
        const grant = parseIceGrant(value, NOW)
        expect(grant).toEqual(value)
        expect(parseIceGrant(grant, NOW)).toEqual(grant)
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
      const relayed = hasTurn(usableIceServers(grant, now))
      expect(relayed).toBe(now < (grant.expiresAt as number) - ICE_EXPIRY_MARGIN_MS)
    }))
  })
})

describe('hasTurn', () => {
  it('sees TURN and TURNS, and not STUN', () => {
    expect(hasTurn([STUN, TURN])).toBe(true)
    expect(hasTurn([{ urls: ['turns:turn.cloudflare.com:5349?transport=tcp'] }])).toBe(true)
    expect(hasTurn([STUN])).toBe(false)
    expect(hasTurn([])).toBe(false)
    expect(hasTurn(undefined)).toBe(false)
  })
})
