import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { previewProblems } from './guard-preview.mjs'

const root = new URL('..', import.meta.url).pathname

/** A build output made of the repo's own index.html and public/ files, which the real build copies unchanged. */
function output() {
  const dir = mkdtempSync(join(tmpdir(), 'preview-'))
  cpSync(join(root, 'public'), dir, { recursive: true })
  cpSync(join(root, 'index.html'), join(dir, 'index.html'))
  return dir
}
const edit = (dir, file, change) => writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')))

test('the repo as it is passes: tags in index.html, image and robots.txt in public/', () => {
  const dir = output()
  assert.deepEqual(previewProblems(dir), [])
  rmSync(dir, { recursive: true })
})

test('a missing tag is named', () => {
  for (const [key, pattern] of [
    ['og:title', /<meta\s+property="og:title"[^>]*>/],
    ['twitter:image', /<meta\s+name="twitter:image"[^>]*>/],
    ['og:image:height', /<meta property="og:image:height"[^>]*>/],
  ]) {
    const dir = output()
    edit(dir, 'index.html', (html) => html.replace(pattern, ''))
    assert.deepEqual(previewProblems(dir), [`index.html has no ${key}`])
    rmSync(dir, { recursive: true })
  }
})

test('an image that is not in the output, is relative, or is too big fails', () => {
  let dir = output()
  rmSync(join(dir, 'og-v1.jpg'))
  assert.match(previewProblems(dir).join('\n'), /og:image points at \/og-v1\.jpg, which is not in/)
  dir = output()
  edit(dir, 'index.html', (html) => html.replaceAll('https://peerly.cc/og-v1.jpg', '/og-v1.jpg'))
  assert.match(previewProblems(dir).join('\n'), /og:image is not an absolute https URL/)
  dir = output()
  writeFileSync(join(dir, 'og-v1.jpg'), Buffer.alloc(200_001))
  assert.match(previewProblems(dir).join('\n'), /over 200000 bytes/)
})

test('robots.txt that is missing or is the app page fails; a missing canonical fails', () => {
  let dir = output()
  rmSync(join(dir, 'robots.txt'))
  assert.match(previewProblems(dir).join('\n'), /robots\.txt is not in the output/)
  dir = output()
  writeFileSync(join(dir, 'robots.txt'), '<!doctype html><html></html>')
  assert.match(previewProblems(dir).join('\n'), /not a robots file/)
  dir = output()
  edit(dir, 'index.html', (html) => html.replace(/<link rel="canonical"[^>]*>/, ''))
  assert.deepEqual(previewProblems(dir), ['index.html has no https canonical link'])
})

test('a directory without index.html fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'preview-'))
  mkdirSync(join(dir, 'x'))
  assert.match(previewProblems(dir)[0], /index\.html is missing/)
})
