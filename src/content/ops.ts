/**
 * Everything said or changed in a workspace is an op: immutable, identified by
 * a random id, and signed by its author's device. Peers relay ops to each
 * other and store them as they are, so each device ends up with the same set
 * and derives the same messages and channels from it (see `derive.ts`).
 *
 * The signature covers every field but itself, in a fixed order: a peer that
 * relays an op cannot change it, and one that makes one up cannot sign it as
 * someone else's device. Whose device a key is, the device-binding check
 * decides (`verify.ts`).
 */
import { verifyWithDeviceKeyId, type DeviceSigner } from '@codefusion-cc/realtime/browser'
import { LIMITS } from '../../shared/app.ts'

export const OP_SCHEME = 'peerly-op-v1'

/** A file attached to a message: what peers need to fetch it (by its SHA-256) and show it before they have it. */
export type FileRef = {
  hash: string
  name: string
  size: number
  type: string
  /** A small WebP preview of an image or video, as a data URL. */
  preview?: string
  width?: number
  height?: number
  /** Kept in the cloud as well (premium): any member can fetch it while nobody who has it is online. */
  cloud?: boolean
}

type Base = { id: string; by: string; dk: string; at: number; sig: string }
export type MessageOp = Base & { kind: 'msg'; c: string; text: string; files?: FileRef[]; reply?: string }
export type EditOp = Base & { kind: 'edit'; target: string; text: string }
export type DeleteOp = Base & { kind: 'del'; target: string }
export type ReactOp = Base & { kind: 'react'; target: string; emoji: string; on: boolean }
export type ChannelOp = Base & { kind: 'chan'; c: string; name: string; pos: number; deleted: boolean }
export type WorkspaceOp = Base & { kind: 'ws'; name: string }
export type Op = MessageOp | EditOp | DeleteOp | ReactOp | ChannelOp | WorkspaceOp
export type OpKind = Op['kind']
export type UnsignedOp = Op extends infer T ? T extends Op ? Omit<T, 'id' | 'by' | 'dk' | 'at' | 'sig'> : never : never

const ID = /^[A-Za-z0-9_-]{16,32}$/
const USER = /^[A-Za-z0-9_-]{8,128}$/
const KEY = /^P-256:[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{43}$/
const SIG = /^[A-Za-z0-9_-]{20,200}$/
const HASH = /^[0-9a-f]{64}$/
const MAX_FILES = 10
const MAX_PREVIEW = 24 * 1024
const MAX_EMOJI = 16
/** An op dated this far ahead of the reader's clock is refused: nobody may pin theirs to the end of a channel. */
const MAX_SKEW_MS = 5 * 60_000

const isString = (value: unknown, max: number, min = 0): value is string => typeof value === 'string' && value.length >= min && value.length <= max
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function parseFile(value: unknown): FileRef | null {
  if (!isRecord(value) || !isString(value.hash, 64) || !HASH.test(value.hash) || !isString(value.name, 255, 1) ||
    !Number.isSafeInteger(value.size) || (value.size as number) < 0 || (value.size as number) > LIMITS.fileBytes ||
    !isString(value.type, 128) || (value.preview !== undefined && (!isString(value.preview, MAX_PREVIEW) || !value.preview.startsWith('data:image/webp;base64,'))) ||
    (value.width !== undefined && !(Number.isInteger(value.width) && (value.width as number) > 0 && (value.width as number) <= 20_000)) ||
    (value.height !== undefined && !(Number.isInteger(value.height) && (value.height as number) > 0 && (value.height as number) <= 20_000)) ||
    (value.cloud !== undefined && typeof value.cloud !== 'boolean')) return null
  return {
    hash: value.hash, name: value.name, size: value.size as number, type: value.type,
    ...(value.preview ? { preview: value.preview } : {}), ...(value.width ? { width: value.width as number } : {}),
    ...(value.height ? { height: value.height as number } : {}), ...(value.cloud ? { cloud: true } : {}),
  }
}

/** An op with every field in shape, copied field by field; null for anything else. */
export function parseOp(value: unknown, now = Date.now()): Op | null {
  if (!isRecord(value) || !isString(value.id, 32) || !ID.test(value.id) || !isString(value.by, 128) || !USER.test(value.by) ||
    !isString(value.dk, 200) || !KEY.test(value.dk) || !Number.isSafeInteger(value.at) || (value.at as number) <= 0 ||
    (value.at as number) > now + MAX_SKEW_MS || !isString(value.sig, 200) || !SIG.test(value.sig)) return null
  const base = { id: value.id, by: value.by, dk: value.dk, at: value.at as number, sig: value.sig }
  const target = isString(value.target, 32) && ID.test(value.target) ? value.target : null
  switch (value.kind) {
    case 'msg': {
      if (!isString(value.c, 32) || !ID.test(value.c) || !isString(value.text, LIMITS.messageText)) return null
      const files = value.files === undefined ? undefined : Array.isArray(value.files) && value.files.length <= MAX_FILES ? value.files.map(parseFile) : null
      if (files === null || files?.some(file => file === null)) return null
      if (!value.text.trim() && !files?.length) return null
      if (value.reply !== undefined && !(isString(value.reply, 32) && ID.test(value.reply))) return null
      return { ...base, kind: 'msg', c: value.c, text: value.text, ...(files?.length ? { files: files as FileRef[] } : {}), ...(value.reply ? { reply: value.reply as string } : {}) }
    }
    case 'edit':
      return target && isString(value.text, LIMITS.messageText) && value.text.trim() ? { ...base, kind: 'edit', target, text: value.text } : null
    case 'del':
      return target ? { ...base, kind: 'del', target } : null
    case 'react':
      return target && isString(value.emoji, MAX_EMOJI, 1) && typeof value.on === 'boolean' ? { ...base, kind: 'react', target, emoji: value.emoji, on: value.on } : null
    case 'chan':
      return isString(value.c, 32) && ID.test(value.c) && isString(value.name, LIMITS.channelName, 1) && value.name.trim() === value.name &&
        Number.isSafeInteger(value.pos) && typeof value.deleted === 'boolean'
        ? { ...base, kind: 'chan', c: value.c, name: value.name, pos: value.pos as number, deleted: value.deleted } : null
    case 'ws':
      return isString(value.name, LIMITS.workspaceName, 1) && value.name.trim() === value.name ? { ...base, kind: 'ws', name: value.name } : null
    default:
      return null
  }
}

/** The exact bytes a device signs: the scheme, then every field but the signature, in one order per kind. */
export function opBytes(op: Omit<Op, 'sig'>): Uint8Array {
  const { id, by, dk, at } = op
  const fields: unknown[] = [OP_SCHEME, op.kind, id, by, dk, at]
  switch (op.kind) {
    case 'msg': fields.push(op.c, op.text, op.files ?? [], op.reply ?? null); break
    case 'edit': fields.push(op.target, op.text); break
    case 'del': fields.push(op.target); break
    case 'react': fields.push(op.target, op.emoji, op.on); break
    case 'chan': fields.push(op.c, op.name, op.pos, op.deleted); break
    case 'ws': fields.push(op.name); break
  }
  return new TextEncoder().encode(JSON.stringify(fields))
}

/** A random id for an op, a channel or a workspace's local record. */
export const newId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

/** A new op by this account, signed by this device. */
export async function signOp<T extends UnsignedOp>(signer: DeviceSigner, userId: string, body: T, now = Date.now()): Promise<Op> {
  const unsigned = { ...body, id: newId(), by: userId, dk: await signer.publicKeyId(), at: now } as Omit<Op, 'sig'>
  const signed = { ...unsigned, sig: await signer.sign(opBytes(unsigned)) } as Op
  if (!parseOp(signed, now)) throw new Error('invalid-op')
  return signed
}

/** Whether the op's signature is its device key's. Whose device that is, `verify.ts` decides. */
export const signedByItsDevice = (op: Op) => verifyWithDeviceKeyId(op.dk, opBytes(op), op.sig)
