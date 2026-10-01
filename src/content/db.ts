/**
 * Where this device keeps workspace content, in IndexedDB: the signed ops
 * (messages, edits, reactions, channels), the files it holds (by SHA-256),
 * and which device keys it has seen the server vouch for, per account.
 *
 * One database per signed-in account, so two accounts on a browser never read
 * each other's workspaces.
 */
import { APP_ID } from '../config.ts'
import type { Op } from './ops.ts'

const VERSION = 2

/** A verified op as kept: its workspace (this device's id for it), and its UTC day for reconciling with peers. */
export type StoredOp = Op & { w: string; day: number }
/** An op whose author's device is not yet known to be theirs: kept apart, unseen and not passed on, until it is. */
export type PendingOp = Op & { w: string }

export type StoredBlob = { w: string; hash: string; blob: Blob; size: number; at: number }
export type DeviceBinding = { key: string; userId: string; deviceKeyId: string; at: number }

let opening: Promise<IDBDatabase> | null = null
let openFor = ''

/** The account's database, opened once. */
export function contentDb(userId: string): Promise<IDBDatabase> {
  if (opening && openFor === userId) return opening
  void opening?.then(db => db.close()).catch(() => {})
  openFor = userId
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`${APP_ID}-content-${userId}`, VERSION)
    request.onupgradeneeded = event => {
      const db = request.result
      if (event.oldVersion < 1) {
        const ops = db.createObjectStore('ops', { keyPath: 'id' })
        ops.createIndex('byChannel', ['w', 'c', 'at'])
        ops.createIndex('byDay', ['w', 'day'])
        ops.createIndex('byTarget', ['w', 'target'])
        ops.createIndex('byKind', ['w', 'kind'])
        ops.createIndex('byWorkspace', 'w')
        const pending = db.createObjectStore('pending', { keyPath: 'id' })
        pending.createIndex('byDevice', ['by', 'dk'])
        pending.createIndex('byWorkspace', 'w')
        db.createObjectStore('devices', { keyPath: 'key' })
      }
      if (event.oldVersion < 2) {
        // Version 1 kept a file once for every workspace; files are per workspace now, each served only there.
        if (db.objectStoreNames.contains('blobs')) db.deleteObjectStore('blobs')
        const blobs = db.createObjectStore('blobs', { keyPath: ['w', 'hash'] })
        blobs.createIndex('byWorkspace', 'w')
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // Another tab upgrading closes this connection; the next call opens again.
      db.onversionchange = () => { db.close(); if (opening) opening = null }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('content-db-blocked'))
  })
  opening.catch(() => { opening = null })
  return opening
}

/** Runs one transaction and resolves with what `work` returned once it committed. */
export async function transact<T>(userId: string, stores: string | string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => T | Promise<T>): Promise<T> {
  const db = await contentDb(userId)
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let result: T
    Promise.resolve(work(tx)).then(value => { result = value }, error => { tx.abort(); reject(error) })
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('aborted'))
  })
}

export const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

/** Deletes everything this device keeps for one workspace (leaving it, or freeing space). */
export async function forgetContent(userId: string, workspaceId: string): Promise<void> {
  await transact(userId, ['ops', 'pending', 'blobs'], 'readwrite', async tx => {
    for (const name of ['ops', 'pending', 'blobs']) {
      const keys = await request(tx.objectStore(name).index('byWorkspace').getAllKeys(workspaceId))
      for (const key of keys) tx.objectStore(name).delete(key)
    }
  })
}

/** Deletes the account's whole database on this device. */
export async function deleteContentDb(userId: string): Promise<void> {
  if (openFor === userId) {
    void opening?.then(db => db.close()).catch(() => {})
    opening = null
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(`${APP_ID}-content-${userId}`)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}
