import { readFileSync } from 'node:fs'

// The wrangler configs allow `//` line comments; strip them before
// JSON.parse. Scans char-by-char tracking string/escape state so a `//`
// inside a quoted value (e.g. a URL) is never mistaken for a comment — a
// regex-based line-suffix strip can't make that distinction reliably.
function parseJsonc(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
      continue
    }
    out += char
  }
  return JSON.parse(out)
}

/** A wrangler config at the repository root, e.g. `wrangler.preview.jsonc`. */
export const readWranglerConfig = file =>
  parseJsonc(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'))
