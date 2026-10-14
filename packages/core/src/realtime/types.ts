export type { ErrorCode, ScopeKind } from '../protocol/index.js'

export type ScopeHandle = {
  routeId: string
  expiresAt: number
}

export type RoomEntry = Record<string, unknown>

export type RoomPage = {
  entries: Array<{ roomId: string; entry: RoomEntry }>
  cursor: string | null
}

export type SeekOptions = {
  seekId: string
  interests: string[]
  /**
   * This seeker's id in the app's own opaque id space — the same space
   * `exclusions` is written in. Everything the server does with either is an
   * equality comparison, so the app can use an id derivable from a user id it
   * already knows (see the consumer's opaque coordination scope) and keep its blocklist
   * client-side. Omit it and exclusions cannot match anything.
   */
  memberId?: string
  exclusions?: string[]
}

export type TransportState = 'offline' | 'enrolling' | 'session' | 'connecting' | 'ready' | 'backoff' | 'upgrade-required'

export type TransportDiagnostics = {
  state: TransportState
  reconnectCount: number
  lastEventAt: number | null
  degraded: boolean
}

export type DeviceSignerLike = {
  publicKeyId(): Promise<string>
  sign(data: Uint8Array): Promise<string>
}

export type OidcCredentialProvider = () => Promise<{ token: string; providerId: string; signer: DeviceSignerLike } | null>
