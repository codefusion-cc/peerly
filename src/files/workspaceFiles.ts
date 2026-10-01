/**
 * A workspace's files on this device: what it keeps, what it is fetching and
 * how far, and the cloud copies of a Premium workspace.
 *
 * A file is named by its SHA-256 and kept once per workspace. Showing one
 * reads it here first, then asks the members online (the data mesh checks the
 * bytes against the hash), then, for a file sent to a Premium workspace, the
 * cloud, where it is sealed with the workspace's key under a name the server
 * cannot link to it (`cloudFileKeys` of @codefusion-cc/realtime).
 *
 * Each file has its own listeners, so a download's progress re-renders that
 * file only.
 */
import { CloudFileError, cloudFileKeys, getCloudFile, putCloudFile, type CloudFileKeys } from '@codefusion-cc/realtime/browser'
import type { DataMesh } from '@codefusion-cc/realtime-p2p'
import { ROUTES } from '../../shared/app.ts'
import { APP_ID } from '../config.ts'
import type { FileRef } from '../content/ops.ts'
import { getFile, putFile } from './fileStore.ts'
import type { PreparedFile } from './prepare.ts'

/** Where a file stands on this device. */
export type FileState =
  | { status: 'idle' }
  | { status: 'fetching'; progress: number }
  | { status: 'local'; url: string | null }
  /** Nobody who has it is online, and the cloud does not keep it. */
  | { status: 'unavailable' }
  | { status: 'failed' }

const IDLE: FileState = { status: 'idle' }
/** Types an <img> may show from this device's copy; anything else is only ever saved, never opened in this origin. */
const SHOWABLE = /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/

type Context = {
  userId: string
  workspaceId: string
  secret: string
  /** The workspace channel's route id, once authorized. */
  routeId(): string | null
  /** Whether the channel keeps history (the owner's Premium): then files go to the cloud too. */
  history(): boolean
  mesh(): DataMesh | null
}

export class WorkspaceFiles {
  private readonly context: Context
  private readonly states = new Map<string, FileState>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly loading = new Map<string, Promise<void>>()
  private readonly urls = new Set<string>()
  private keys: Promise<CloudFileKeys> | null = null
  private closed = false

  constructor(context: Context) {
    this.context = context
  }

  state = (hash: string): FileState => this.states.get(hash) ?? IDLE

  subscribe = (hash: string, listener: () => void) => {
    const set = this.listeners.get(hash) ?? new Set()
    set.add(listener)
    this.listeners.set(hash, set)
    return () => { set.delete(listener) }
  }

  private set(hash: string, state: FileState) {
    if (this.closed) return
    this.states.set(hash, state)
    for (const listener of this.listeners.get(hash) ?? []) listener()
  }

  private cloudKeys() {
    this.keys ??= cloudFileKeys(APP_ID, this.context.secret)
    return this.keys
  }

  private async cloudUrl(hash: string) {
    const routeId = this.context.routeId()
    return routeId ? `${ROUTES.files}${routeId}/${await (await this.cloudKeys()).fileId(hash)}` : null
  }

  /** This device's copy, shown where the type allows. */
  private local(hash: string, blob: Blob, type: string) {
    let url: string | null = null
    if (SHOWABLE.test(type)) {
      url = URL.createObjectURL(blob.type === type ? blob : new Blob([blob], { type }))
      this.urls.add(url)
    }
    this.set(hash, { status: 'local', url })
  }

  /** What members ask for over the mesh: a file this device keeps for this workspace. */
  provide = (hash: string) => getFile(this.context.userId, this.context.workspaceId, hash)

  /**
   * Keeps the files being sent and, in a Premium workspace, stores their
   * sealed copies in the cloud, one at a time (`onProgress` from 0 to 1).
   * Answers the references to send: `cloud` on each the cloud now keeps.
   * A file the cloud refused is still sent: members get it from this device.
   */
  async prepareToSend(files: PreparedFile[], onProgress?: (fraction: number) => void): Promise<{ refs: FileRef[]; notKept: number }> {
    for (const file of files) {
      await putFile(this.context.userId, this.context.workspaceId, file.ref.hash, file.blob)
      this.local(file.ref.hash, file.blob, file.ref.type)
    }
    if (!this.context.history() || !this.context.routeId()) return { refs: files.map(file => file.ref), notKept: 0 }
    const total = files.reduce((sum, file) => sum + file.ref.size, 0) || 1
    let done = 0
    let notKept = 0
    const refs: FileRef[] = []
    for (const file of files) {
      try {
        const url = await this.cloudUrl(file.ref.hash)
        if (!url) throw new CloudFileError('no-history')
        const sealed = await (await this.cloudKeys()).seal(file.ref.hash, file.blob)
        await putCloudFile(url, sealed, { onProgress: sent => onProgress?.(Math.min(1, (done + sent * (file.ref.size / sealed.size)) / total)) })
        refs.push({ ...file.ref, cloud: true })
      } catch {
        notKept += 1
        refs.push(file.ref)
      }
      done += file.ref.size
      onProgress?.(done / total)
    }
    return { refs, notKept }
  }

  /** Brings a file to this device (once at a time), from here, the members online or the cloud. */
  load(ref: FileRef): Promise<void> {
    const current = this.state(ref.hash)
    if (current.status === 'local' || current.status === 'fetching') return this.loading.get(ref.hash) ?? Promise.resolve()
    const loading = this.fetch(ref).finally(() => this.loading.delete(ref.hash))
    this.loading.set(ref.hash, loading)
    return loading
  }

  private async fetch(ref: FileRef) {
    const { userId, workspaceId } = this.context
    this.set(ref.hash, { status: 'fetching', progress: 0 })
    const held = await getFile(userId, workspaceId, ref.hash).catch(() => null)
    if (held) return this.local(ref.hash, held, ref.type)
    const mesh = this.context.mesh()
    if (mesh) {
      try {
        const blob = await mesh.fetchBlob(ref.hash, { onProgress: ({ received, size }) => this.set(ref.hash, { status: 'fetching', progress: size ? received / size : 0 }) })
        await putFile(userId, workspaceId, ref.hash, blob)
        return this.local(ref.hash, blob, ref.type)
      } catch {
        // Nobody online had it (or it did not hash right): the cloud may.
      }
    }
    if (ref.cloud) {
      try {
        const url = await this.cloudUrl(ref.hash)
        if (url) {
          const sealed = await getCloudFile(url, { onProgress: (received, total) => this.set(ref.hash, { status: 'fetching', progress: total ? received / total : 0 }) })
          const blob = await (await this.cloudKeys()).open(ref.hash, sealed, ref.type)
          await putFile(userId, workspaceId, ref.hash, blob)
          return this.local(ref.hash, blob, ref.type)
        }
      } catch (error) {
        if (!(error instanceof CloudFileError && (error.code === 'not-found' || error.code === 'no-history'))) return this.set(ref.hash, { status: 'failed' })
      }
    }
    this.set(ref.hash, { status: 'unavailable' })
  }

  /** Saves a file this device has to the person's downloads; never opens it here (it could run as this site). */
  async save(ref: FileRef): Promise<boolean> {
    const blob = await getFile(this.context.userId, this.context.workspaceId, ref.hash)
    if (!blob) return false
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }))
    const link = document.createElement('a')
    link.href = url
    link.download = ref.name
    link.rel = 'noopener'
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return true
  }

  close() {
    this.closed = true
    for (const url of this.urls) URL.revokeObjectURL(url)
    this.urls.clear()
    this.listeners.clear()
  }
}
