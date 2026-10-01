// Writes docs/legal/*.md from the in-app legal texts (src/legal/legalContent.ts).
import { writeFileSync } from 'node:fs'
import { LEGAL_FILES, legalMarkdown } from '../src/legal/legalMarkdown.ts'

for (const [id, file] of Object.entries(LEGAL_FILES)) {
  writeFileSync(new URL(`../${file}`, import.meta.url), legalMarkdown(id))
  console.log(`legal:export ${file}`)
}
