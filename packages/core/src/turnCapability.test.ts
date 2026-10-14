import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeTurnCapability, resolveProbeIceServers } from './turnCapability.js'

vi.mock('./realtime/runtime.js', () => ({
  getDurableObjectsIceServers: vi.fn(async () => [{
    urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'do-user', credential: 'do-credential',
  }]),
}))

const TURN = [{
  urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'user', credential: 'pass',
}]

class FakePeerConnection {
  static created: RTCConfiguration[] = []
  onicecandidate: ((event: { candidate: { type: string; protocol: string } | null }) => void) | null = null
  onicecandidateerror: ((event: { errorText?: string }) => void) | null = null
  constructor(config: RTCConfiguration) { FakePeerConnection.created.push(config) }
  createDataChannel() {}
  async createOffer() { return {} }
  async setLocalDescription() {
    queueMicrotask(() => this.onicecandidate?.({ candidate: { type: 'relay', protocol: 'tcp' } }))
  }
  close() {}
}

describe('probeTurnCapability', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does not probe when the deployment hands out STUN alone', async () => {
    FakePeerConnection.created = []
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    await expect(probeTurnCapability({}, 20, async () => [{ urls: ['stun:stun.cloudflare.com:3478'] }])).resolves.toEqual({
      status: 'not-configured',
      detail: 'TURN is not configured.',
      transports: [],
    })
    expect(FakePeerConnection.created).toEqual([])
  })

  it('turns browser policy failures into an unavailable result', async () => {
    vi.stubGlobal('RTCPeerConnection', class {
      constructor() {
        throw new Error('TURN blocked by administrator')
      }
    })
    await expect(probeTurnCapability(
      {},
      20,
      async () => TURN
    )).resolves.toMatchObject({
      status: 'unavailable',
      detail: expect.stringContaining('blocked by administrator'),
    })
  })

  it('does not attempt anonymous TURN when runtime credentials are unavailable', async () => {
    const PeerConnection = vi.fn()
    vi.stubGlobal('RTCPeerConnection', PeerConnection)

    await expect(probeTurnCapability(
      {},
      20,
      async () => undefined
    )).resolves.toMatchObject({
      status: 'unavailable',
      detail: expect.stringContaining('credentials are unavailable'),
    })
    expect(PeerConnection).not.toHaveBeenCalled()
  })

  it('succeeds on the first relay candidate without waiting for gathering to finish', async () => {
    FakePeerConnection.created = []
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)

    await expect(probeTurnCapability({}, 20, async () => TURN)).resolves.toEqual({
      status: 'available',
      detail: 'TURN relay allocation succeeded (tcp).',
      transports: ['tcp'],
    })
    expect(FakePeerConnection.created).toEqual([{ iceServers: TURN, iceTransportPolicy: 'relay' }])
  })
})

describe('resolveProbeIceServers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('takes the servers from the Durable Objects session, the default strategy', async () => {
    await expect(resolveProbeIceServers({ VITE_APP_ID: 'consumer-app' })).resolves.toEqual([{
      urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'do-user', credential: 'do-credential',
    }])
  })

  it('has no TURN to test on the dev strategies', async () => {
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    await expect(resolveProbeIceServers({ VITE_SIGNALING: 'nostr' })).resolves.toEqual([])
    await expect(probeTurnCapability({ VITE_SIGNALING: 'nostr' }, 20)).resolves.toMatchObject({ status: 'not-configured' })
  })
})
