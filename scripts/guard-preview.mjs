import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

/**
 * Fails the build if the page the Worker serves for every route lacks what a
 * shared link needs: scrapers (Messenger, WhatsApp, Slack) read the HTML and
 * run no JavaScript. Checks the Open Graph and Twitter tags in dist/index.html,
 * that og:image is an absolute https URL of a JPEG in the output within budget,
 * a canonical link, and a robots.txt that is text and not the app's HTML.
 */
const MAX_IMAGE_BYTES = 200_000
const REQUIRED = [
  ['property', 'og:type'],
  ['property', 'og:url'],
  ['property', 'og:title'],
  ['property', 'og:description'],
  ['property', 'og:image'],
  ['property', 'og:image:width'],
  ['property', 'og:image:height'],
  ['name', 'twitter:card'],
  ['name', 'twitter:title'],
  ['name', 'twitter:description'],
  ['name', 'twitter:image'],
  ['name', 'description'],
]

function metaContent(html, attribute, key) {
  for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
    if (new RegExp(`\\b${attribute}="${key}"`).test(tag)) return /\bcontent="([^"]*)"/.exec(tag)?.[1]
  }
}

/** Problems with a build output directory; an empty list means it is fine. */
export function previewProblems(dist) {
  const problems = []
  const indexPath = join(dist, 'index.html')
  if (!existsSync(indexPath)) return [`${indexPath} is missing`]
  const html = readFileSync(indexPath, 'utf8')
  for (const [attribute, key] of REQUIRED) {
    if (!metaContent(html, attribute, key)) problems.push(`index.html has no ${key}`)
  }
  if (!/<link\b[^>]*rel="canonical"[^>]*href="https:\/\/[^"]+"/.test(html)) problems.push('index.html has no https canonical link')
  if (metaContent(html, 'name', 'twitter:card') !== 'summary_large_image') problems.push('twitter:card is not summary_large_image')
  for (const key of ['og:image', 'twitter:image']) {
    const url = metaContent(html, key.startsWith('og') ? 'property' : 'name', key)
    if (!url) continue
    if (!/^https:\/\/[^/]+\/[^?#]+\.jpg$/.test(url)) {
      problems.push(`${key} is not an absolute https URL of a .jpg: ${url}`)
      continue
    }
    const file = join(dist, new URL(url).pathname)
    if (!existsSync(file)) problems.push(`${key} points at ${new URL(url).pathname}, which is not in ${dist}/`)
    else if (statSync(file).size > MAX_IMAGE_BYTES) problems.push(`${new URL(url).pathname} is over ${MAX_IMAGE_BYTES} bytes`)
  }
  const robots = join(dist, 'robots.txt')
  if (!existsSync(robots)) problems.push('robots.txt is not in the output (every unknown path would answer with the app)')
  else if (!/^User-agent:/im.test(readFileSync(robots, 'utf8')) || /<html/i.test(readFileSync(robots, 'utf8'))) problems.push('robots.txt is not a robots file')
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.env.BUILD_OUT_DIR || 'dist'
  const problems = previewProblems(dist)
  if (problems.length) {
    console.error(`guard:preview failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log('guard:preview ok')
}
