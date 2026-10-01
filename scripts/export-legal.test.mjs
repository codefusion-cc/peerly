import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { LEGAL_FILES, legalMarkdown } from '../src/legal/legalMarkdown.ts'

test('docs/legal holds exactly the English text the app shows (run npm run legal:export after editing it)', () => {
  for (const [id, file] of Object.entries(LEGAL_FILES)) {
    assert.equal(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), legalMarkdown(id))
  }
})
