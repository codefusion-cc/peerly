/**
 * What a workspace shows, worked out from its ops the same way on every
 * device, whatever order they arrived in:
 * - a channel is its latest `chan` op (by time, then id);
 * - the workspace's name is the owner's latest `ws` op;
 * - a message is its `msg` op with the author's latest edit, gone once its
 *   author deletes it, and the reactions each person last left on it.
 * Only a message's author may edit or delete it; anyone else's attempt is ignored.
 */
import type { ChannelOp, FileRef, MessageOp, Op } from './ops.ts'

export type Channel = { id: string; name: string; pos: number }
export type Reaction = { emoji: string; by: string[] }
export type Message = {
  id: string
  channelId: string
  by: string
  dk: string
  at: number
  text: string
  files: FileRef[]
  reply?: string
  editedAt?: number
  deleted: boolean
  reactions: Reaction[]
}

/** Whether `a` came after `b`: later, or at the same time a larger id (so every device agrees). */
export const later = (a: Pick<Op, 'at' | 'id'>, b: Pick<Op, 'at' | 'id'>) => a.at > b.at || (a.at === b.at && a.id > b.id)

/** The channels, ordered (deleted ones left out). */
export function deriveChannels(ops: Iterable<Op>): Channel[] {
  const latest = new Map<string, ChannelOp>()
  for (const op of ops) {
    if (op.kind !== 'chan') continue
    const current = latest.get(op.c)
    if (!current || later(op, current)) latest.set(op.c, op)
  }
  return [...latest.values()].filter(op => !op.deleted)
    .sort((a, b) => a.pos - b.pos || a.name.localeCompare(b.name) || a.c.localeCompare(b.c))
    .map(op => ({ id: op.c, name: op.name, pos: op.pos }))
}

/** The workspace's name as its owner last set it, or null. */
export function deriveWorkspaceName(ops: Iterable<Op>, ownerUserId: string): string | null {
  let latest: Extract<Op, { kind: 'ws' }> | null = null
  for (const op of ops) if (op.kind === 'ws' && op.by === ownerUserId && (!latest || later(op, latest))) latest = op
  return latest?.name ?? null
}

/** A channel's messages, oldest first, with edits, deletions and reactions applied. */
export function deriveMessages(channelId: string, ops: Iterable<Op>): Message[] {
  const messages = new Map<string, MessageOp>()
  const changes: Op[] = []
  for (const op of ops) {
    if (op.kind === 'msg' && op.c === channelId) messages.set(op.id, op)
    else if (op.kind === 'edit' || op.kind === 'del' || op.kind === 'react') changes.push(op)
  }
  const edits = new Map<string, Extract<Op, { kind: 'edit' }>>()
  const deleted = new Set<string>()
  const reactions = new Map<string, Map<string, Extract<Op, { kind: 'react' }>>>()
  for (const op of changes) {
    if (op.kind === 'react') {
      if (!messages.has(op.target)) continue
      const byKey = reactions.get(op.target) ?? new Map()
      const key = `${op.by}\n${op.emoji}`
      const current = byKey.get(key)
      if (!current || later(op, current)) byKey.set(key, op)
      reactions.set(op.target, byKey)
      continue
    }
    const target = messages.get(op.target)
    // Only the author changes their own message.
    if (!target || target.by !== op.by) continue
    if (op.kind === 'del') deleted.add(op.target)
    else {
      const current = edits.get(op.target)
      if (!current || later(op, current)) edits.set(op.target, op)
    }
  }
  return [...messages.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).map(op => {
    const edit = edits.get(op.id)
    const gone = deleted.has(op.id)
    const grouped = new Map<string, string[]>()
    for (const reaction of reactions.get(op.id)?.values() ?? []) {
      if (!reaction.on) continue
      grouped.set(reaction.emoji, [...grouped.get(reaction.emoji) ?? [], reaction.by])
    }
    return {
      id: op.id, channelId: op.c, by: op.by, dk: op.dk, at: op.at,
      text: gone ? '' : edit?.text ?? op.text, files: gone ? [] : op.files ?? [],
      ...(op.reply ? { reply: op.reply } : {}), ...(edit && !gone ? { editedAt: edit.at } : {}), deleted: gone,
      reactions: gone ? [] : [...grouped].map(([emoji, by]) => ({ emoji, by: by.sort() })),
    }
  })
}
