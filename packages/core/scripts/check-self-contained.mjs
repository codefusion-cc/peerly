/**
 * Refuses a package that would not work once installed: a file in `worker/` or `dist/` importing a path outside
 * packages/core (the app's own `src/`), or a package that is not among its dependencies. The app imports these files
 * in place, where both resolve, so nothing else would notice before someone installed the release.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {}), manifest.name])
const IMPORT = /(?:^|[^\w$.])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(mjs|js)$/.test(name) && !/\.test\.|workers\.test|test-fixtures/.test(name)) yield path
  }
}

const problems = []
for (const top of ['worker', 'dist']) {
  let entries
  try { entries = [...files(join(root, top))] } catch { continue }
  for (const file of entries) {
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const spec = match[1] ?? match[2]
      if (spec.startsWith('.')) {
        if (relative(root, resolve(dirname(file), spec)).startsWith('..')) problems.push(`${relative(root, file)} imports ${spec}, outside the package`)
      } else if (!spec.startsWith('node:') && !spec.startsWith('cloudflare:') && !builtinModules.includes(spec)) {
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
        if (!declared.has(name)) problems.push(`${relative(root, file)} imports ${spec}, not a dependency`)
      }
    }
  }
}

if (problems.length) {
  console.error(`@peerly/core would ship broken:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('@peerly/core is self-contained')
