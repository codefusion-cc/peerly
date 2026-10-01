/**
 * The files this device holds, per workspace, by the SHA-256 of their
 * content: what it shows, saves and hands to members who ask
 * (`provide` of the data mesh).
 */
import { request, transact, type StoredBlob } from '../content/db.ts'

/** Keeps a file for a workspace (again: the same bytes are kept once). */
export async function putFile(userId: string, w: string, hash: string, blob: Blob): Promise<void> {
  await transact(userId, 'blobs', 'readwrite', tx => {
    tx.objectStore('blobs').put({ w, hash, blob, size: blob.size, at: Date.now() } satisfies StoredBlob)
  })
}

/** The file with this hash in this workspace, or null when this device does not have it. */
export async function getFile(userId: string, w: string, hash: string): Promise<Blob | null> {
  return transact(userId, 'blobs', 'readonly', async tx => {
    const stored = await request(tx.objectStore('blobs').get([w, hash])) as StoredBlob | undefined
    return stored?.blob ?? null
  })
}

/** How many files, and how many bytes, this device keeps for a workspace. */
export async function filesUsage(userId: string, w: string): Promise<{ files: number; bytes: number }> {
  return transact(userId, 'blobs', 'readonly', async tx => {
    const all = await request(tx.objectStore('blobs').index('byWorkspace').getAll(w)) as StoredBlob[]
    return { files: all.length, bytes: all.reduce((sum, item) => sum + item.size, 0) }
  })
}
