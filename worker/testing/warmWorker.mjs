import { env } from 'cloudflare:workers'
import { beforeAll } from 'vitest'

/**
 * Starts the Worker's Durable Objects once per test file, before its first
 * test: loading them with @codefusion-cc/realtime takes about 2 s on an idle
 * machine and well past 5 s on a busy one, which is not any test's own work.
 */
beforeAll(async () => {
  await env.USER_GATEWAYS.getByName('peerly:warm-up').validateChannelSession({ sid: 'warm-up', dk: 'warm-up' })
})
