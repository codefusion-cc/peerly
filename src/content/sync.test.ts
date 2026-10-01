import { describe, expect, it } from 'vitest'
import { DeviceIdentity, createMemoryKvStore } from '@codefusion-cc/realtime/browser'
import { batchOps, createSync, parseSyncMessage, type SyncMessage, type SyncStore } from './sync.ts'
import { signOp, type Op } from './ops.ts'

const DAY = 86_400_000
const signer = new DeviceIdentity(createMemoryKvStore<CryptoKeyPair>())

async function messages(count: number, startAt: number, step = 60_000): Promise<Op[]> {
  return Promise.all(Array.from({ length: count }, (_, i) =>
    signOp(signer, 'author-user-1', { kind: 'msg', c: 'channel-general-01', text: `message ${i}` }, startAt + i * step)))
}

/** A device's ops in memory, with the sync's store over them. */
function device(initial: Op[]) {
  const ops = new Map(initial.map(op => [op.id, op]))
  const dayOf = (at: number) => Math.floor(at / DAY)
  const store: SyncStore = {
    async summary() {
      const days = new Map<number, string[]>()
      for (const op of ops.values()) days.set(dayOf(op.at), [...days.get(dayOf(op.at)) ?? [], op.id])
      return Promise.all([...days].sort((a, b) => a[0] - b[0]).map(async ([day, ids]) => {
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ids.sort().join('\n'))))]
          .map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)
        return [day, ids.length, digest] as [number, number, string]
      }))
    },
    async idsOfDay(day) { return [...ops.values()].filter(op => dayOf(op.at) === day).map(op => op.id) },
    async ops(ids) { return ids.flatMap(id => ops.has(id) ? [ops.get(id)!] : []) },
    async receive(received) { for (const op of received) ops.set(op.id, op) },
  }
  return { ops, store }
}

/** Two devices linked: every message goes through the parser, as it would off the wire. Runs until quiet. */
async function link(a: ReturnType<typeof device>, b: ReturnType<typeof device>) {
  const queue: Array<{ to: 'a' | 'b'; message: SyncMessage }> = []
  const sent: SyncMessage[] = []
  const syncA = createSync(a.store, (_to, message) => { queue.push({ to: 'b', message }); sent.push(message) })
  const syncB = createSync(b.store, (_to, message) => { queue.push({ to: 'a', message }); sent.push(message) })
  await Promise.all([syncA.open('b'), syncB.open('a')])
  while (queue.length) {
    const { to, message } = queue.shift()!
    const parsed = parseSyncMessage(JSON.parse(JSON.stringify(message)))
    expect(parsed).not.toBeNull()
    await (to === 'a' ? syncA : syncB).handle(to === 'a' ? 'b' : 'a', parsed!)
  }
  return sent
}

describe('sync', () => {
  it('leaves both devices with every op either had, across days', async () => {
    const start = Date.UTC(2026, 8, 1)
    const shared = await messages(5, start)
    const onlyA = await messages(3, start + 2 * DAY)
    const onlyB = await messages(4, start + 5 * DAY)
    const a = device([...shared, ...onlyA])
    const b = device([...shared, ...onlyB])
    await link(a, b)
    expect([...a.ops.keys()].sort()).toEqual([...b.ops.keys()].sort())
    expect(a.ops.size).toBe(12)
  })

  it('sends each missing op once', async () => {
    const start = Date.UTC(2026, 8, 1)
    const shared = await messages(4, start)
    const a = device([...shared, ...await messages(3, start + DAY)])
    const b = device([...shared, ...await messages(2, start + DAY)])
    const sent = await link(a, b)
    expect(sent.filter(message => message.t === 'ops').flatMap(message => (message as { ops: Op[] }).ops).length).toBe(5)
  })

  it('sends nothing but the summaries when both are already in step', async () => {
    const ops = await messages(20, Date.UTC(2026, 8, 1), 3_600_000)
    const sent = await link(device(ops), device(ops))
    expect(sent.map(message => message.t)).toEqual(['days', 'days'])
  })

  it('brings a new device up to date from nothing, and the other gains nothing it lacked', async () => {
    const ops = await messages(1_500, Date.UTC(2026, 8, 1), 1_000)
    const a = device(ops)
    const b = device([])
    const sent = await link(a, b)
    expect(b.ops.size).toBe(1_500)
    // A day with more ids than one message holds goes in several.
    expect(sent.filter(message => message.t === 'ids').length).toBeGreaterThan(1)
    expect(sent.filter(message => message.t === 'ops').every(message => (message as { ops: Op[] }).ops.length <= 200)).toBe(true)
  })
})

describe('parseSyncMessage', () => {
  it('refuses anything not in shape', async () => {
    const [op] = await messages(1, Date.now() - 1000)
    for (const value of [
      null, 'days', { t: 'nope' }, { t: 'days', days: 'x' }, { t: 'days', days: [[1, 2]] }, { t: 'days', days: [[1, -1, 'a'.repeat(32)]] },
      { t: 'days', days: [[1, 1, 'not-hex'.padEnd(32, 'z')]] }, { t: 'days', days: Array.from({ length: 401 }, (_, i) => [i, 1, 'a'.repeat(32)]) },
      { t: 'ids', day: 1, ids: ['short'], last: true }, { t: 'ids', day: 1.5, ids: [], last: true }, { t: 'ids', day: 1, ids: [] },
      { t: 'ids', day: 1, ids: Array.from({ length: 1001 }, (_, i) => `id-${String(i).padStart(20, '0')}`), last: true },
      { t: 'want', ids: Array.from({ length: 201 }, (_, i) => `id-${String(i).padStart(20, '0')}`) },
      { t: 'ops', ops: [{ ...op, text: 'edited after signing', sig: 'x' }] }, { t: 'ops', ops: [{ ...op, kind: 'other' }] },
    ]) expect(parseSyncMessage(value)).toBeNull()
    expect(parseSyncMessage({ t: 'ops', ops: [op] })).toEqual({ t: 'ops', ops: [op] })
  })
})

describe('batchOps', () => {
  it('keeps each message under the limit, and an op too big alone goes by itself', async () => {
    const ops = await messages(10, Date.now() - 100_000)
    const size = JSON.stringify(ops[0]).length
    const batches = batchOps(ops, size * 3 + 1)
    expect(batches.map(batch => batch.length)).toEqual([3, 3, 3, 1])
    expect(batchOps(ops, 1).every(batch => batch.length === 1)).toBe(true)
    expect(batchOps([])).toEqual([])
  })
})
