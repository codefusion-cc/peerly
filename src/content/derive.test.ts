import { describe, expect, it } from 'vitest'
import { DeviceIdentity, createMemoryKvStore } from '@codefusion-cc/realtime/browser'
import { deriveChannels, deriveMessages, deriveWorkspaceName } from './derive.ts'
import { signOp, type Op } from './ops.ts'

const ann = new DeviceIdentity(createMemoryKvStore<CryptoKeyPair>())
const bob = new DeviceIdentity(createMemoryKvStore<CryptoKeyPair>())
const ANN = 'ann-user-id-1'
const BOB = 'bob-user-id-1'
const C = 'channel-general-01'
/** Every order of a few ops gives the same result. */
const shuffled = <T>(items: T[]) => [items, [...items].reverse(), [...items.slice(1), items[0]]]

describe('deriveMessages', () => {
  it('applies the author\'s latest edit and deletion, in any order the ops arrived', async () => {
    const message = await signOp(ann, ANN, { kind: 'msg', c: C, text: 'first' }, 1_000)
    const edit1 = await signOp(ann, ANN, { kind: 'edit', target: message.id, text: 'second' }, 2_000)
    const edit2 = await signOp(ann, ANN, { kind: 'edit', target: message.id, text: 'third' }, 3_000)
    for (const ops of shuffled<Op>([message, edit1, edit2])) {
      expect(deriveMessages(C, ops)).toMatchObject([{ id: message.id, text: 'third', editedAt: 3_000, deleted: false }])
    }
    const removed = await signOp(ann, ANN, { kind: 'del', target: message.id }, 4_000)
    expect(deriveMessages(C, [edit2, removed, message])).toMatchObject([{ text: '', deleted: true, files: [], reactions: [] }])
  })

  it('ignores anyone but the author editing or deleting a message', async () => {
    const message = await signOp(ann, ANN, { kind: 'msg', c: C, text: 'mine' }, 1_000)
    const edit = await signOp(bob, BOB, { kind: 'edit', target: message.id, text: 'hijacked' }, 2_000)
    const removed = await signOp(bob, BOB, { kind: 'del', target: message.id }, 3_000)
    expect(deriveMessages(C, [message, edit, removed])).toMatchObject([{ text: 'mine', deleted: false }])
  })

  it('counts each person\'s latest reaction per emoji', async () => {
    const message = await signOp(ann, ANN, { kind: 'msg', c: C, text: 'react to me' }, 1_000)
    const ops = [
      message,
      await signOp(ann, ANN, { kind: 'react', target: message.id, emoji: '👍', on: true }, 2_000),
      await signOp(bob, BOB, { kind: 'react', target: message.id, emoji: '👍', on: true }, 2_100),
      await signOp(bob, BOB, { kind: 'react', target: message.id, emoji: '👍', on: false }, 2_200),
      await signOp(bob, BOB, { kind: 'react', target: message.id, emoji: '🎉', on: true }, 2_300),
    ]
    for (const order of shuffled(ops)) {
      expect(deriveMessages(C, order)[0].reactions).toEqual([{ emoji: '👍', by: [ANN] }, { emoji: '🎉', by: [BOB] }])
    }
  })

  it('keeps one channel\'s messages, oldest first, ties by id', async () => {
    const a = await signOp(ann, ANN, { kind: 'msg', c: C, text: 'a' }, 5_000)
    const b = await signOp(bob, BOB, { kind: 'msg', c: C, text: 'b' }, 5_000)
    const other = await signOp(bob, BOB, { kind: 'msg', c: 'channel-random-001', text: 'elsewhere' }, 1_000)
    const derived = deriveMessages(C, [other, b, a])
    expect(derived.map(item => item.id)).toEqual([a, b].sort((x, y) => x.id.localeCompare(y.id)).map(item => item.id))
  })
})

describe('deriveChannels and the workspace name', () => {
  it('takes each channel\'s latest change, leaves out deleted ones, and orders by position', async () => {
    const ops = [
      await signOp(ann, ANN, { kind: 'chan', c: C, name: 'general', pos: 0, deleted: false }, 1_000),
      await signOp(bob, BOB, { kind: 'chan', c: 'channel-random-001', name: 'random', pos: 1, deleted: false }, 1_000),
      await signOp(bob, BOB, { kind: 'chan', c: C, name: 'announcements', pos: 2, deleted: false }, 2_000),
      await signOp(ann, ANN, { kind: 'chan', c: 'channel-old-00001', name: 'old', pos: 3, deleted: false }, 1_000),
      await signOp(ann, ANN, { kind: 'chan', c: 'channel-old-00001', name: 'old', pos: 3, deleted: true }, 3_000),
    ]
    for (const order of shuffled(ops)) {
      expect(deriveChannels(order)).toEqual([{ id: 'channel-random-001', name: 'random', pos: 1 }, { id: C, name: 'announcements', pos: 2 }])
    }
  })

  it('takes the workspace name from its owner only', async () => {
    const ops = [
      await signOp(ann, ANN, { kind: 'ws', name: 'Team' }, 1_000),
      await signOp(bob, BOB, { kind: 'ws', name: 'Bob took over' }, 2_000),
    ]
    expect(deriveWorkspaceName(ops, ANN)).toBe('Team')
    expect(deriveWorkspaceName(ops, 'nobody-at-all')).toBeNull()
  })
})
