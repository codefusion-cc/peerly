/**
 * The ops a device keeps, and what it hands its peers when they compare.
 *
 * Verified ops live in `ops`; an op whose author's device is not yet known to
 * be theirs waits in `pending` and is promoted once the server vouches for
 * that device (`bindDevice`). Writes are idempotent: the same op from two
 * peers is kept once.
 */
import { request, transact, type PendingOp, type StoredOp } from './db.ts'
import type { Op } from './ops.ts'

const DAY_MS = 86_400_000
/** How far back peers compare: older ops are kept, not re-offered. */
export const SYNC_DAYS = 365
/** A channel's messages are read this many at a time. */
export const WINDOW = 150

export const dayOf = (at: number) => Math.floor(at / DAY_MS)
const strip = ({ w: _w, day: _day, ...op }: StoredOp) => op as Op
const bindingKey = (userId: string, deviceKeyId: string) => `${userId}\n${deviceKeyId}`

/** Keeps ops for a workspace; answers those that were new. Ops from an unconfirmed device go to `pending`. */
export async function putOps(userId: string, w: string, ops: Op[], bound: (op: Op) => boolean): Promise<Op[]> {
  if (!ops.length) return []
  return transact(userId, ['ops', 'pending'], 'readwrite', async tx => {
    const added: Op[] = []
    const store = tx.objectStore('ops')
    for (const op of ops) {
      if (await request(store.getKey(op.id)) !== undefined) continue
      if (bound(op)) {
        store.put({ ...op, w, day: dayOf(op.at) } satisfies StoredOp)
        tx.objectStore('pending').delete(op.id)
        added.push(op)
      } else {
        tx.objectStore('pending').put({ ...op, w } satisfies PendingOp)
      }
    }
    return added
  })
}

/** Records that the server vouched for this device as this account's, and promotes the ops that waited on it. */
export async function bindDevice(userId: string, author: string, deviceKeyId: string): Promise<Array<{ w: string; op: Op }>> {
  return transact(userId, ['devices', 'ops', 'pending'], 'readwrite', async tx => {
    const key = bindingKey(author, deviceKeyId)
    if (await request(tx.objectStore('devices').getKey(key)) === undefined) {
      tx.objectStore('devices').put({ key, userId: author, deviceKeyId, at: Date.now() })
    }
    const waiting = await request(tx.objectStore('pending').index('byDevice').getAll([author, deviceKeyId])) as PendingOp[]
    const promoted: Array<{ w: string; op: Op }> = []
    for (const { w, ...op } of waiting) {
      tx.objectStore('pending').delete(op.id)
      if (await request(tx.objectStore('ops').getKey(op.id)) !== undefined) continue
      tx.objectStore('ops').put({ ...op, w, day: dayOf(op.at) })
      promoted.push({ w, op: op as Op })
    }
    return promoted
  })
}

/** The devices the server has vouched for, as `userId\ndeviceKeyId`. */
export async function boundDevices(userId: string): Promise<Set<string>> {
  const keys = await transact(userId, 'devices', 'readonly', tx => request(tx.objectStore('devices').getAllKeys()))
  return new Set(keys as string[])
}
export { bindingKey }

/** The workspace's channel and name ops: few, and all of them shape what it shows. */
export async function metaOps(userId: string, w: string): Promise<Op[]> {
  return transact(userId, 'ops', 'readonly', async tx => {
    const index = tx.objectStore('ops').index('byKind')
    const [channels, names] = await Promise.all([request(index.getAll([w, 'chan'])), request(index.getAll([w, 'ws']))])
    return [...channels, ...names].map(op => strip(op as StoredOp))
  })
}

/**
 * A channel's latest messages before `before` (all, when not given), with the
 * edits, deletions and reactions that change them; `more` says older ones exist.
 */
export async function channelWindow(userId: string, w: string, c: string, before = Number.MAX_SAFE_INTEGER, limit = WINDOW): Promise<{ ops: Op[]; more: boolean }> {
  return transact(userId, 'ops', 'readonly', async tx => {
    const store = tx.objectStore('ops')
    const range = IDBKeyRange.bound([w, c, 0], [w, c, before], false, true)
    const messages: StoredOp[] = []
    await new Promise<void>((resolve, reject) => {
      const cursor = store.index('byChannel').openCursor(range, 'prev')
      cursor.onerror = () => reject(cursor.error)
      cursor.onsuccess = () => {
        const current = cursor.result
        if (!current || messages.length > limit) return resolve()
        messages.push(current.value as StoredOp)
        current.continue()
      }
    })
    const more = messages.length > limit
    const shown = messages.slice(0, limit)
    const changes = await Promise.all(shown.map(op => request(store.index('byTarget').getAll([w, op.id]))))
    return { ops: [...shown, ...changes.flat()].map(op => strip(op as StoredOp)), more }
  })
}

/** The edits, deletions and reactions of one message (to apply a new one to a window already shown). */
export async function changesOf(userId: string, w: string, target: string): Promise<Op[]> {
  return transact(userId, 'ops', 'readonly', async tx =>
    (await request(tx.objectStore('ops').index('byTarget').getAll([w, target]))).map(op => strip(op as StoredOp)))
}

/** One message op by id, to reply to or jump to. */
export async function getOp(userId: string, id: string): Promise<Op | null> {
  const stored = await transact(userId, 'ops', 'readonly', tx => request(tx.objectStore('ops').get(id)))
  return stored ? strip(stored as StoredOp) : null
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** Each day's count and digest (of its sorted op ids), for the days that have ops, newest `SYNC_DAYS`. */
export async function daySummary(userId: string, w: string, now = Date.now()): Promise<Array<[day: number, count: number, digest: string]>> {
  const first = dayOf(now) - SYNC_DAYS
  // A key cursor reads each op's day and id from the index alone, never the ops themselves.
  const byDay = await transact(userId, 'ops', 'readonly', tx => new Promise<Map<number, string[]>>((resolve, reject) => {
    const grouped = new Map<number, string[]>()
    const cursor = tx.objectStore('ops').index('byDay').openKeyCursor(IDBKeyRange.bound([w, first], [w, dayOf(now) + 1]))
    cursor.onerror = () => reject(cursor.error)
    cursor.onsuccess = () => {
      const current = cursor.result
      if (!current) return resolve(grouped)
      const day = (current.key as [string, number])[1]
      const ids = grouped.get(day)
      if (ids) ids.push(current.primaryKey as string)
      else grouped.set(day, [current.primaryKey as string])
      current.continue()
    }
  }))
  return Promise.all([...byDay].sort((a, b) => a[0] - b[0]).map(async ([day, ids]) =>
    [day, ids.length, hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ids.sort().join('\n')))).slice(0, 32)] as [number, number, string]))
}

/** The ids of one day's ops. */
export async function idsOfDay(userId: string, w: string, day: number): Promise<string[]> {
  return transact(userId, 'ops', 'readonly', async tx =>
    (await request(tx.objectStore('ops').index('byDay').getAllKeys([w, day]))) as string[])
}

/** The ops with these ids that this device has (verified), for a peer that lacks them. */
export async function opsById(userId: string, w: string, ids: string[]): Promise<Op[]> {
  return transact(userId, 'ops', 'readonly', async tx => {
    const found = await Promise.all(ids.map(id => request(tx.objectStore('ops').get(id))))
    return (found as Array<StoredOp | undefined>).filter((op): op is StoredOp => op?.w === w).map(strip)
  })
}

/** Which of these ids this device has, verified or waiting. */
export async function knownIds(userId: string, ids: string[]): Promise<Set<string>> {
  return transact(userId, ['ops', 'pending'], 'readonly', async tx => {
    const known = await Promise.all(ids.map(async id =>
      await request(tx.objectStore('ops').getKey(id)) !== undefined || await request(tx.objectStore('pending').getKey(id)) !== undefined ? id : null))
    return new Set(known.filter((id): id is string => id !== null))
  })
}
