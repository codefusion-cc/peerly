import { test } from 'node:test'
import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = JSON.parse(readFileSync(new URL('../stryker.config.json', import.meta.url), 'utf8'))

// Stryker only warns about a mutate pattern that matches nothing, so a renamed
// or deleted file would quietly drop out of the weekly mutation run. Patterns
// may be globs with a `:start-end` line range; `!` patterns only exclude.
test('every pattern the mutation run mutates matches a file', () => {
  const patterns = config.mutate.filter(pattern => !pattern.startsWith('!'))
  assert.ok(patterns.length > 0)
  for (const pattern of patterns) {
    const files = globSync(pattern.replace(/:\d+(:\d+)?-\d+(:\d+)?$/, ''), { cwd: root })
    assert.ok(files.length > 0, `${pattern} in stryker.config.json matches no file`)
  }
})

// Stryker rewrites the tsconfig's paths for its sandbox with the TypeScript API,
// which TypeScript 7 no longer has. The tsconfigs name nothing outside the
// repository, so there is nothing to rewrite: an empty name skips the step.
test('Stryker leaves the tsconfig alone', () => {
  assert.equal(config.tsconfigFile, '')
  for (const file of globSync('tsconfig*.json', { cwd: root })) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /"\.\.\//, `${file} names a path outside the repository`)
  }
})
