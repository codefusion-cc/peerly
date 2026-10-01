import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Fails the build if a production bundle contains material that must never
 * reach users: the end-to-end test issuer's RSA private key. It is public in
 * git and mints tokens a test Worker accepts, so it must never ship.
 *
 * The protection is bundler dead-code elimination (see src/auth/e2eSignIn.ts), which is
 * easy to defeat by accident — a stray static `import './e2eKeys.ts'`, or routing
 * the guard through a function the bundler cannot fold. This asserts the
 * outcome rather than trusting the mechanism.
 */
const DIST = process.argv[2] ?? 'dist'

// Distinctive fragments of the E2E private key and its issuer material.
const FORBIDDEN = [
  { label: 'E2E RSA private exponent (d)', needle: 'NqIymRvy3qsy_VGDrWFbp70XvKmt6c4Mc9r8aT1BoNtor' },
  { label: 'E2E RSA prime (p)', needle: '8p03H2OFkL4sVSwxfbQ_3LWa7QO1f9uJPD4k0sXwEDRny' },
  { label: 'E2E fake-Google public modulus (n)', needle: 'zrpA9xwzeaU2ZndxJNk7I3wH8scLSOW5UVgYqEl478G1MyGLsk0A6aQtZrJVky1uwbocZEDeYcRA48YM1W6wv8WOucjkd05yWse2uB' },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

let files
try {
  files = walk(DIST)
} catch {
  console.error(`guard:bundle — no ${DIST}/ directory. Run "npm run build" first.`)
  process.exit(1)
}

const violations = []
for (const file of files) {
  const contents = readFileSync(file, 'utf8')
  for (const { label, needle } of FORBIDDEN) {
    if (contents.includes(needle)) violations.push(`${label} found in ${file}`)
  }
}

if (violations.length > 0) {
  console.error('guard:bundle FAILED — forbidden credential material is in the production bundle:\n')
  for (const violation of violations) console.error(`  - ${violation}`)
  console.error(
    '\nThe E2E auth fixtures must stay behind the dead-code guard in src/auth/e2eSignIn.ts.\n' +
      'Check for a static import of ./e2eKeys, or a guard the bundler cannot fold to a constant.'
  )
  process.exit(1)
}

console.log(`guard:bundle OK — no test key or static credential material in ${files.length} bundled files.`)
