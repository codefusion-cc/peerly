import { describe, expect, it } from 'vitest'
import { createAccountKeys } from '@codefusion-cc/realtime/browser'
import { newerMemberList, normalizeEmail, normalizeEmails, parseMemberList, signMemberList, verifyMemberList } from './memberList.ts'

const keys = createAccountKeys('peerly')
const scope = 'A'.repeat(43)
const owner = 'owner-user-id-123'

describe('member lists', () => {
  it('normalizes addresses: trimmed, lower case, unique, sorted; refuses what is not an address', () => {
    expect(normalizeEmail('  Ann@Example.COM ')).toBe('ann@example.com')
    for (const value of ['', 'ann', '@example.com', 'ann@', 'a b@example.com', 42, null, `${'a'.repeat(65)}@x.com`]) expect(normalizeEmail(value)).toBeNull()
    expect(normalizeEmails(['b@x.com', 'A@x.com', 'a@x.com'])).toEqual(['a@x.com', 'b@x.com'])
    expect(normalizeEmails([])).toBeNull()
    expect(normalizeEmails(['a@x.com', 'nope'])).toBeNull()
    expect(normalizeEmails(Array.from({ length: 501 }, (_, i) => `p${i}@x.com`))).toBeNull()
    expect(normalizeEmails(Array.from({ length: 500 }, (_, i) => `p${i}@x.com`))).toHaveLength(500)
  })

  it('verifies for the owner key that signed it, and for nothing edited', async () => {
    const secrets = await keys.generateSecrets()
    const other = await keys.generateSecrets()
    const list = await signMemberList(keys, secrets, { scope, ownerUserId: owner, emails: ['b@x.com', 'A@x.com'] })
    expect(list.emails).toEqual(['a@x.com', 'b@x.com'])
    expect(parseMemberList(list)).toEqual(list)
    expect(await verifyMemberList(keys, list)).toBe(true)
    for (const edited of [
      { ...list, emails: ['a@x.com', 'b@x.com', 'c@x.com'] }, { ...list, emails: ['a@x.com'] }, { ...list, revision: list.revision + 1 },
      { ...list, scope: 'B'.repeat(43) }, { ...list, ownerUserId: 'someone-else-12' }, { ...list, ownerKeyId: other.accountKeyId },
    ]) expect(await verifyMemberList(keys, edited)).toBe(false)
  })

  it('always moves forward, even when the clock went back', async () => {
    const secrets = await keys.generateSecrets()
    const first = await signMemberList(keys, secrets, { scope, ownerUserId: owner, emails: ['a@x.com'], now: 5_000 })
    const second = await signMemberList(keys, secrets, { scope, ownerUserId: owner, emails: ['a@x.com', 'b@x.com'], previous: first.revision, now: 1_000 })
    expect(second.revision).toBe(5_001)
    expect(newerMemberList(first, second)).toBe(second)
    expect(newerMemberList(second, first)).toBe(second)
    expect(newerMemberList(second, { ...second })).toBe(second)
  })

  it('takes only a list already in canonical form, with every field in shape', async () => {
    const secrets = await keys.generateSecrets()
    const list = await signMemberList(keys, secrets, { scope, ownerUserId: owner, emails: ['a@x.com', 'b@x.com'] })
    for (const broken of [
      null, [], 'list', { ...list, emails: ['b@x.com', 'a@x.com'] }, { ...list, emails: ['A@x.com', 'b@x.com'] }, { ...list, scope: 'short' },
      { ...list, ownerKeyId: 'P-256:x:y' }, { ...list, ownerUserId: 'x' }, { ...list, revision: 0 }, { ...list, revision: 1.5 },
      { ...list, signature: 'tiny' },
    ]) expect(parseMemberList(broken)).toBeNull()
  })
})
