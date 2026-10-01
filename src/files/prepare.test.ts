import { describe, expect, it } from 'vitest'
import { cleanName } from './prepare.ts'

describe('cleanName', () => {
  it('keeps an ordinary name as it is, unicode included', () => {
    expect(cleanName('Raport końcowy (v2).pdf')).toBe('Raport końcowy (v2).pdf')
    expect(cleanName('🎉.png')).toBe('🎉.png')
  })

  it('drops any path and control characters', () => {
    expect(cleanName('C:\\Users\\ala\\secret.txt')).toBe('secret.txt')
    expect(cleanName('../../etc/passwd')).toBe('passwd')
    expect(cleanName('a\u0000b\nc.txt')).toBe('abc.txt')
  })

  it('names a file that has none', () => {
    expect(cleanName('')).toBe('file')
    expect(cleanName('   ')).toBe('file')
    expect(cleanName('dir/')).toBe('file')
  })

  it('shortens a long name to 255 characters, keeping its extension', () => {
    const long = `${'a'.repeat(300)}.docx`
    const clean = cleanName(long)
    expect(clean).toHaveLength(255)
    expect(clean.endsWith('….docx')).toBe(true)
    expect(cleanName('a'.repeat(255))).toHaveLength(255)
    expect(cleanName(`${'a'.repeat(256)}`)).toHaveLength(255)
    // No extension worth keeping: an over-long tail after a dot is just more name.
    expect(cleanName(`x.${'b'.repeat(300)}`)).toHaveLength(255)
  })
})
