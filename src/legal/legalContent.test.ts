import { describe, expect, it } from 'vitest'
import { legalDocs } from './legalContent.ts'

describe('legal texts', () => {
  it('has the same sections in Polish and English', () => {
    for (const id of ['privacy', 'terms'] as const) {
      const shape = (locale: 'en' | 'pl') => legalDocs[locale][id].sections.map(section => [
        section.heading.split('.')[0], section.blocks.map(block => Object.keys(block)[0] === 'ul' ? `ul${(block as { ul: string[] }).ul.length}` : Object.keys(block)[0]),
      ])
      expect(shape('pl')).toEqual(shape('en'))
    }
  })
})
