/**
 * How two peers bring each other's ops up to date, over their direct link.
 *
 * When a link opens, each side sends a count and digest of each day's ops.
 * For a day that differs, the other side sends that day's op ids, and each
 * side sends the ops the other lacks. Both do the same, so one exchange leaves
 * both with the union, each op crosses once, and a day already in step costs
 * one line. `want` asks for particular ops (a reply's original, say). Only verified ops are offered: a device passes on what
 * it trusts, never what it is still waiting to verify.
 */
import { parseOp, type Op } from './ops.ts'

export type SyncMessage =
  | { t: 'days'; days: Array<[number, number, string]> }
  | { t: 'ids'; day: number; ids: string[]; last: boolean }
  | { t: 'want'; ids: string[] }
  | { t: 'ops'; ops: Op[] }

/** What the sync reads and writes, for one workspace on this device. */
export type SyncStore = {
  summary(): Promise<Array<[number, number, string]>>
  idsOfDay(day: number): Promise<string[]>
  ops(ids: string[]): Promise<Op[]>
  /** Ops a peer sent: the caller verifies and keeps them. */
  receive(ops: Op[], from: string): Promise<void>
}

/** Ids in one message: about 25 KB. */
const IDS_PER_MESSAGE = 1_000
/** Ops asked for at a time. */
const WANT_PER_MESSAGE = 200
/** An ops message stays under the mesh's message limit (64 KiB) with room to spare. */
const OPS_BYTES = 48 * 1024
const ID = /^[A-Za-z0-9_-]{16,32}$/
const MAX_DAYS = 400

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const ids = (value: unknown, max: number) => Array.isArray(value) && value.length <= max && value.every(id => typeof id === 'string' && ID.test(id))
  ? value as string[] : null

/** A sync message in shape; null for anything else (a peer's message is never trusted as it comes). */
export function parseSyncMessage(value: unknown): SyncMessage | null {
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'days': {
      if (!Array.isArray(value.days) || value.days.length > MAX_DAYS) return null
      const days = value.days.filter((day): day is [number, number, string] => Array.isArray(day) && day.length === 3 &&
        Number.isSafeInteger(day[0]) && Number.isSafeInteger(day[1]) && day[1] >= 0 && typeof day[2] === 'string' && /^[0-9a-f]{32}$/.test(day[2]))
      return days.length === value.days.length ? { t: 'days', days } : null
    }
    case 'ids': {
      const list = ids(value.ids, IDS_PER_MESSAGE)
      return list && Number.isSafeInteger(value.day) && typeof value.last === 'boolean' ? { t: 'ids', day: value.day as number, ids: list, last: value.last } : null
    }
    case 'want': {
      const list = ids(value.ids, WANT_PER_MESSAGE)
      return list ? { t: 'want', ids: list } : null
    }
    case 'ops': {
      if (!Array.isArray(value.ops) || value.ops.length > WANT_PER_MESSAGE) return null
      const ops = value.ops.map(op => parseOp(op))
      return ops.every(Boolean) ? { t: 'ops', ops: ops as Op[] } : null
    }
    default:
      return null
  }
}

/** Splits ops into messages under the size limit (an op too big alone still goes, by itself). */
export function batchOps(ops: Op[], limit = OPS_BYTES): Op[][] {
  const batches: Op[][] = []
  let current: Op[] = []
  let size = 0
  for (const op of ops) {
    const bytes = JSON.stringify(op).length
    if (current.length && (size + bytes > limit || current.length >= WANT_PER_MESSAGE)) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(op)
    size += bytes
  }
  if (current.length) batches.push(current)
  return batches
}

/** The sync for one workspace: call `open` when a link to a peer opens, and `handle` with each sync message from it. */
export function createSync(store: SyncStore, send: (to: string, message: SyncMessage) => void) {
  /** A day's ids from a peer, gathered across messages until the last. */
  const gathering = new Map<string, string[]>()

  const sendOps = async (to: string, wanted: string[]) => {
    for (let start = 0; start < wanted.length; start += WANT_PER_MESSAGE) {
      const ops = await store.ops(wanted.slice(start, start + WANT_PER_MESSAGE))
      for (const batch of batchOps(ops)) send(to, { t: 'ops', ops: batch })
    }
  }
  const sendIds = (to: string, day: number, list: string[]) => {
    if (!list.length) return send(to, { t: 'ids', day, ids: [], last: true })
    for (let start = 0; start < list.length; start += IDS_PER_MESSAGE) {
      send(to, { t: 'ids', day, ids: list.slice(start, start + IDS_PER_MESSAGE), last: start + IDS_PER_MESSAGE >= list.length })
    }
  }

  return {
    /** A link to `peer` opened: tell it what this device has, by day. */
    async open(peer: string) {
      send(peer, { t: 'days', days: await store.summary() })
    },

    async handle(peer: string, message: SyncMessage) {
      switch (message.t) {
        case 'days': {
          const mine = new Map((await store.summary()).map(([day, count, digest]) => [day, `${count}:${digest}`]))
          const theirs = new Map(message.days.map(([day, count, digest]) => [day, `${count}:${digest}`]))
          // A day either side has and the two disagree on: show ours, so the peer can work out the difference.
          for (const day of new Set([...mine.keys(), ...theirs.keys()])) {
            if (mine.get(day) !== theirs.get(day)) sendIds(peer, day, await store.idsOfDay(day))
          }
          return
        }
        case 'ids': {
          const key = `${peer}\n${message.day}`
          const theirs = [...gathering.get(key) ?? [], ...message.ids]
          if (!message.last) {
            gathering.set(key, theirs)
            return
          }
          gathering.delete(key)
          const mine = await store.idsOfDay(message.day)
          const theirSet = new Set(theirs)
          // What they lack goes to them. They do the same with ours, so nothing needs asking for, and nothing crosses twice.
          await sendOps(peer, mine.filter(id => !theirSet.has(id)))
          return
        }
        case 'want':
          return sendOps(peer, message.ids)
        case 'ops':
          return store.receive(message.ops, peer)
      }
    },

    /** Asks a peer for particular ops by id. */
    want(peer: string, wanted: string[]) {
      for (let start = 0; start < wanted.length; start += WANT_PER_MESSAGE) send(peer, { t: 'want', ids: wanted.slice(start, start + WANT_PER_MESSAGE) })
    },

    /** The peer is gone: forget what it was in the middle of sending. */
    close(peer: string) {
      for (const key of gathering.keys()) if (key.startsWith(`${peer}\n`)) gathering.delete(key)
    },
  }
}
