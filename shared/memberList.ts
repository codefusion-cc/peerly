/**
 * Who may be in a workspace: the owner's signed list of email addresses.
 *
 * The owner's account key signs it, so any of the owner's linked devices can
 * change it and nobody else can. It is bound to one workspace (`scope`, a
 * capability derived from the workspace's secret) so a list cannot be moved
 * to another workspace of the same owner, and it carries a revision so a newer
 * list replaces an older one and never the reverse. Both the Worker and every
 * member check it before trusting it.
 */
import { LIMITS } from './app.ts'

export const MEMBER_LIST_SCHEME = 'peerly-workspace-members-v3'

/** The owner's signed list. */
export type MemberList = {
  /** The workspace's capability (43 base64url characters), derived from its secret. */
  scope: string
  /** The owner's account key id (`P-256:<x>:<y>`), which signs every revision. */
  ownerKeyId: string
  /** The owner's public user id: who decides what the workspace's plan pays for. */
  ownerUserId: string
  /** Normalized, unique and sorted. */
  emails: string[]
  /** Milliseconds; each new list must be later than the last. */
  revision: number
  signature: string
}

const CAPABILITY = /^[A-Za-z0-9_-]{43}$/
const KEY_ID = /^P-256:[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{43}$/
const USER_ID = /^[A-Za-z0-9_-]{8,128}$/
const SIGNATURE = /^[A-Za-z0-9_-]{20,200}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,189}$/

/** An address as lists hold it: trimmed and lower case; null for one that is not an address. */
export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  return normalized.length <= 254 && EMAIL.test(normalized) ? normalized : null
}

/** The addresses, normalized, unique and sorted; null when one is not an address or there are too many or none. */
export function normalizeEmails(emails: unknown): string[] | null {
  if (!Array.isArray(emails) || emails.length === 0) return null
  const normalized = emails.map(normalizeEmail)
  if (normalized.some(email => email === null)) return null
  const unique = [...new Set(normalized as string[])].sort()
  return unique.length <= LIMITS.workspaceMembers ? unique : null
}

/** The exact bytes the owner signs: never JSON of the object, whose key order is not part of its meaning. */
export function memberListBytes(list: Omit<MemberList, 'signature'>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([MEMBER_LIST_SCHEME, list.scope, list.ownerKeyId, list.ownerUserId, list.emails, list.revision]))
}

/** A list with every field in shape (not yet verified); null otherwise. */
export function parseMemberList(value: unknown): MemberList | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const list = value as Record<string, unknown>
  const emails = normalizeEmails(list.emails)
  if (!emails || typeof list.scope !== 'string' || !CAPABILITY.test(list.scope) ||
    typeof list.ownerKeyId !== 'string' || !KEY_ID.test(list.ownerKeyId) ||
    typeof list.ownerUserId !== 'string' || !USER_ID.test(list.ownerUserId) ||
    !Number.isSafeInteger(list.revision) || (list.revision as number) <= 0 ||
    typeof list.signature !== 'string' || !SIGNATURE.test(list.signature)) return null
  // Must already be canonical: a signature covers the normalized list, not one a client rearranged.
  if (JSON.stringify(emails) !== JSON.stringify(list.emails)) return null
  return {
    scope: list.scope, ownerKeyId: list.ownerKeyId, ownerUserId: list.ownerUserId, emails,
    revision: list.revision as number, signature: list.signature,
  }
}

/** What the owner's account key signs a list as (`signAsAccount`). */
export const MEMBER_LIST_PURPOSE = 'workspace-members'

/** The account-key operations a list needs: `createAccountKeys(APP_ID)` from `@codefusion-cc/realtime/browser`. */
type ListKeys = {
  signAsAccount(secrets: { accountKeyId: string } & Record<string, unknown>, purpose: string, data: Uint8Array): Promise<string>
  verifyAccountSignature(accountKeyId: string, purpose: string, data: Uint8Array, signature: string): Promise<boolean>
}

/** Whether the list is signed by the owner key it names. Every reader runs this before trusting a list. */
export async function verifyMemberList(keys: Pick<ListKeys, 'verifyAccountSignature'>, list: MemberList): Promise<boolean> {
  return keys.verifyAccountSignature(list.ownerKeyId, MEMBER_LIST_PURPOSE, memberListBytes(list), list.signature)
}

/** A new revision of the list, signed with the owner's account key; later than `previous` even if the clock went back. */
export async function signMemberList(
  keys: Pick<ListKeys, 'signAsAccount'>,
  secrets: { accountKeyId: string } & Record<string, unknown>,
  input: { scope: string; ownerUserId: string; emails: string[]; previous?: number; now?: number },
): Promise<MemberList> {
  const emails = normalizeEmails(input.emails)
  if (!emails) throw new Error('invalid-member-list')
  const unsigned = {
    scope: input.scope, ownerKeyId: secrets.accountKeyId, ownerUserId: input.ownerUserId, emails,
    revision: Math.max(input.now ?? Date.now(), (input.previous ?? 0) + 1),
  }
  const list = { ...unsigned, signature: await keys.signAsAccount(secrets, MEMBER_LIST_PURPOSE, memberListBytes(unsigned)) }
  if (!parseMemberList(list)) throw new Error('invalid-member-list')
  return list
}

/** The newer of two lists both verified for one workspace; on a tie the first, which was already held. */
export const newerMemberList = (held: MemberList, received: MemberList): MemberList => received.revision > held.revision ? received : held
