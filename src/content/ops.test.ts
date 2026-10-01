import { describe, expect, it } from 'vitest'
import { DeviceIdentity, createMemoryKvStore } from '@codefusion-cc/realtime/browser'
import { opBytes, parseOp, signedByItsDevice, signOp, type Op } from './ops.ts'

const device = () => new DeviceIdentity(createMemoryKvStore<CryptoKeyPair>())
const USER = 'author-user-1'
const CHANNEL = 'channel-general-01'
const HASH = 'a'.repeat(64)

describe('ops', () => {
  it('signs every kind so its device verifies it, and an edited op does not verify', async () => {
    const signer = device()
    const ops = await Promise.all([
      signOp(signer, USER, { kind: 'msg', c: CHANNEL, text: 'hello', files: [{ hash: HASH, name: 'a.png', size: 10, type: 'image/png' }], reply: 'message-id-000000' }),
      signOp(signer, USER, { kind: 'edit', target: 'message-id-000000', text: 'hello!' }),
      signOp(signer, USER, { kind: 'del', target: 'message-id-000000' }),
      signOp(signer, USER, { kind: 'react', target: 'message-id-000000', emoji: '👍', on: true }),
      signOp(signer, USER, { kind: 'chan', c: CHANNEL, name: 'general', pos: 0, deleted: false }),
      signOp(signer, USER, { kind: 'ws', name: 'Team' }),
    ])
    for (const op of ops) {
      expect(parseOp(JSON.parse(JSON.stringify(op)))).toEqual(op)
      expect(await signedByItsDevice(op)).toBe(true)
    }
    const message = ops[0] as Extract<Op, { kind: 'msg' }>
    for (const forged of [
      { ...message, text: 'something else' }, { ...message, c: 'channel-other-0001' }, { ...message, at: message.at + 1 },
      { ...message, by: 'someone-else-12' }, { ...message, files: [] }, { ...message, reply: undefined },
    ]) expect(await signedByItsDevice(forged as Op)).toBe(false)
    // Another device's key under this op is refused.
    expect(await signedByItsDevice({ ...message, dk: await device().publicKeyId() })).toBe(false)
  })

  it('binds the kind and each field into what is signed', async () => {
    const signer = device()
    const op = await signOp(signer, USER, { kind: 'react', target: 'message-id-000000', emoji: '👍', on: true })
    const flipped = { ...op, on: false } as Op
    expect(new TextDecoder().decode(opBytes(op))).not.toBe(new TextDecoder().decode(opBytes(flipped)))
    expect(await signedByItsDevice(flipped)).toBe(false)
  })

  it('refuses ops out of shape, or dated in the future', async () => {
    const op = await signOp(device(), USER, { kind: 'msg', c: CHANNEL, text: 'hi' })
    for (const value of [
      null, [], { ...op, kind: 'other' }, { ...op, id: 'short' }, { ...op, by: 'x' }, { ...op, dk: 'P-256:a:b' }, { ...op, at: 0 },
      { ...op, at: Date.now() + 10 * 60_000 }, { ...op, text: '   ' }, { ...op, text: 'x'.repeat(8_001) }, { ...op, c: 'bad channel' },
      { ...op, files: [{ hash: 'nope', name: 'a', size: 1, type: 'x' }] }, { ...op, files: Array.from({ length: 11 }, () => ({ hash: HASH, name: 'a', size: 1, type: 'x' })) },
      { ...op, files: [{ hash: HASH, name: 'a', size: 1, type: 'x', preview: 'data:image/png;base64,AAAA' }] },
      { ...op, files: [{ hash: HASH, name: 'a', size: 200 * 1024 * 1024, type: 'x' }] },
      { ...op, kind: 'chan', c: CHANNEL, name: ' padded ', pos: 0, deleted: false }, { ...op, kind: 'react', target: 'message-id-000000', emoji: '', on: true },
    ]) expect(parseOp(value)).toBeNull()
    // A message with only files and no text is fine.
    const withFile = await signOp(device(), USER, { kind: 'msg', c: CHANNEL, text: '', files: [{ hash: HASH, name: 'a.bin', size: 1, type: '' }] })
    expect(parseOp(withFile)).not.toBeNull()
  })
})
