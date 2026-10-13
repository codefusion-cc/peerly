import { consoleAdmin } from '@codefusion-cc/console/worker'
import manifest from './manifest.json' with { type: 'json' }

/**
 * What CodeFusion Console reads Peerly through, over its `PEERLY_ADMIN`
 * service binding only (a WorkerEntrypoint has no address of its own). No
 * records yet: the manifest declares the Worker secrets, which the console's
 * Secrets page checks in each environment and makes where they are missing.
 */
export const ConsoleAdmin = consoleAdmin({ manifest, resources: {} })
