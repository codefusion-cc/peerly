/**
 * What CodeFusion Console reads Peerly through, over its `PEERLY_ADMIN`
 * service binding only: the accounts in the app's AccountDirectory, and the
 * premium grants staff make. ./manifest.json describes the screens; the
 * package checks each action's permission, scope and reason before it runs.
 */
import { consoleAdmin, type ActionCall } from '@codefusion-cc/console/worker'
import { accountDirectoryName, gatewayName, retryOnReset, type DirectoryAccount } from '@codefusion-cc/realtime'
import { APP_ID, PREMIUM } from '../../shared/app.ts'
import manifest from './manifest.json' with { type: 'json' }

type Stub<T> = { getByName(name: string): T }
type Directory = {
  list(query: { search?: string; plan?: string; sort?: 'lastSeen' | 'created'; dir?: 'asc' | 'desc'; cursor?: string | null; limit?: number }): Promise<{ items: DirectoryAccount[]; total: number; nextCursor: string | null }>
  get(userId: string): Promise<DirectoryAccount | null>
  uidFor(userId: string): Promise<string | null>
}
type Gateway = { setMembership(grant: { plan: string | null; until?: number | null; by: string; note?: string }): Promise<{ ok: boolean }> }
export type AdminEnv = { ACCOUNT_DIRECTORY: Stub<Directory>; USER_GATEWAYS: Stub<Gateway> }

const DAY = 24 * 60 * 60_000
/** How long a grant lasts, from the action's `length` input. */
export const GRANT_LENGTHS: Record<string, number | null> = { '1m': 31 * DAY, '3m': 92 * DAY, '1y': 366 * DAY, forever: null }

const directory = (env: AdminEnv) => env.ACCOUNT_DIRECTORY.getByName(accountDirectoryName(APP_ID))

/** An account as the manifest shows it: `free` stands for no plan. */
function record(account: DirectoryAccount | null) {
  return account && { ...account, plan: account.plan ?? 'free' }
}

/** Sets the plan of each account, through its own gateway (which tells its tabs and the directory). */
async function setPlans({ env, ids, actor }: ActionCall<AdminEnv>, grant: { plan: string | null; until?: number | null; note?: string }) {
  let done = 0
  for (const userId of ids) {
    const uid = await retryOnReset(() => directory(env).uidFor(userId))
    if (!uid) continue
    const result = await retryOnReset(() => env.USER_GATEWAYS.getByName(gatewayName(APP_ID, uid)).setMembership({ ...grant, by: actor.email }))
    if (result.ok) done += 1
  }
  return done
}

export const ConsoleAdmin = consoleAdmin<AdminEnv>({
  manifest,
  resources: {
    accounts: {
      async list(query, { env }) {
        const plan = query.filters?.plan === 'free' ? 'none' : query.filters?.plan === PREMIUM ? PREMIUM : undefined
        const page = await retryOnReset(() => directory(env).list({
          search: query.search, plan, cursor: query.cursor ?? null, limit: query.limit,
          sort: query.sort?.key === 'createdAt' ? 'created' : 'lastSeen', dir: query.sort?.dir,
        }))
        return { ...page, items: page.items.map(item => record(item)!) }
      },
      get: async (id, { env }) => record(await retryOnReset(() => directory(env).get(id))),
      actions: {
        'grant-premium': async call => {
          const length = GRANT_LENGTHS[String(call.input.length)]
          if (length === undefined) return { ok: false, message: 'Choose how long' }
          const note = typeof call.input.note === 'string' && call.input.note.trim() ? call.input.note.trim().slice(0, 500) : undefined
          const done = await setPlans(call, { plan: PREMIUM, until: length === null ? null : Date.now() + length, ...(note ? { note } : {}) })
          return done ? { ok: true, message: done === 1 ? 'Premium granted' : `Premium granted to ${done} accounts` } : { ok: false, message: 'No such account' }
        },
        'end-premium': async call => {
          const done = await setPlans(call, { plan: null, ...(call.reason ? { note: call.reason.slice(0, 500) } : {}) })
          return done ? { ok: true, message: done === 1 ? 'Premium ended' : `Premium ended for ${done} accounts` } : { ok: false, message: 'No such account' }
        },
      },
    },
  },
})
