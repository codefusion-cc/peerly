// Checks a deployment from outside: the site answers with HSTS, and its
// Worker can get Cloudflare TURN credentials (the public media health check,
// which never hands any out).
//   pnpm run verify:production                       # https://peerly.cc
//   PRODUCTION_SITE_URL=https://preview.peerly.cc pnpm run verify:production

const site = process.env.PRODUCTION_SITE_URL || 'https://peerly.cc'
const failures = []

const siteResponse = await fetch(site, { redirect: 'manual' })
if (!siteResponse.ok) failures.push(`site: HTTP ${siteResponse.status}`)
if (!/max-age=\d+/.test(siteResponse.headers.get('strict-transport-security') ?? '')) {
  failures.push('site: missing HSTS')
}

const healthResponse = await fetch(new URL('/api/media/health', site))
const health = await healthResponse.json().catch(() => null)
if (health?.turn?.ok !== true) {
  failures.push(`TURN: ${health ? `ok is ${health.turn?.ok}` : `HTTP ${healthResponse.status}`}`)
}

if (failures.length) {
  failures.forEach(failure => console.error(`FAIL ${failure}`))
  process.exit(1)
}
console.log(`${site}: HSTS set, Cloudflare TURN credentials issued in ${health.turn.ms} ms.`)
