# Peerly Durable Objects cutover

Production (`peerly.cc`, [`wrangler.jsonc`](../wrangler.jsonc)) signals through
the Worker's Durable Objects and keeps messages and files peer to peer
(`CONTENT_BACKEND=p2p`). The `preview.peerly.cc` Worker
([`wrangler.preview.jsonc`](../wrangler.preview.jsonc)) also keeps content in
Durable Objects (`CONTENT_BACKEND=durable-objects`). This runbook covers moving
production content to Durable Objects, and back. HeyHubs has its own
repository, bindings and rollout procedure.

The self-hosted relay and TURN server (the VPS) is retired; no build uses it.

## Before changing production

Use one reviewed commit for the browser and Worker. Run:

```sh
npm ci --ignore-scripts
npm run lint
npm test
npm run test:workers
npm run build
npm run build:preview
npm run worker:check
npm run check:csp
npm run test:e2e
npm run test:e2e:do
```

Both browser suites use a real local Worker and SQLite objects with a test
identity provider. They do not prove real Google OAuth configuration, public
DNS, or TURN across two networks. Check those separately on preview with two
devices, including one cellular connection. Verify the live version/commit.

In preview, exercise sign-in, friend discovery and encrypted invitations,
chat and reactions, channel rename/deletion, a fresh browser replaying content
with other members offline, lost-ACK retry, device revocation with sockets
open, file transfer, and calls. Confirm public presence contains a certificate
and never an OIDC ID token or email claim. Complete the preview soak/exit
criteria in `DURABLE_OBJECTS_ARCHITECTURE.md` before promoting the backend.

Both Workers already require these secrets (wrangler refuses to deploy without
them):

- `NETWORK_SESSION_SECRET` and `OPAQUE_USER_ID_SECRET` for account sessions.
- `RENDEZVOUS_SECRET` for opaque discovery IDs and short-lived public-lobby
  certificates. Rotating it invalidates both; coordinate browser refreshes.
- `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`, the Cloudflare Realtime TURN key,
  provisioned through CodeFusion Console and never set by hand.

Provider client IDs, allowed origins, and JWKS configuration must match the
deployed hostname. Never copy secret values into JSONC or logs.

## Namespaces and migrations

Production already binds all four classes (`UserGatewayDO`, `SignalScopeDO`,
`ContentChannelDO`, `LobbyChannelDO`) under migration tag `realtime-v1`.
Content needs no new namespace. For a class added later, append a new tag;
never rewrite an applied tag, and do not copy preview's history (its deleted
`WorkspaceDO`, `realtime-v2`, `realtime-v3`). Channel state and
session-subscriber tables are idempotent SQLite schema upgrades inside existing
objects, not namespace migrations.

## Switch content

The browser build and the Worker must agree:

| Setting | Browser build | Worker runtime |
|---|---|---|
| Content | `VITE_CONTENT_BACKEND=durable-objects` | `CONTENT_BACKEND=durable-objects` |

Set `CONTENT_BACKEND` in production `wrangler.jsonc` and add
`VITE_CONTENT_BACKEND=durable-objects` to the build step of the `deploy
production` job in `.github/workflows/ci.yml`. Vite variables are substituted
at build time; setting Worker `vars` cannot update an already-built browser.
Signaling needs no setting: every build defaults to `durable-objects`.

```sh
VITE_CONTENT_BACKEND=durable-objects npm run build
npm run worker:check
npm run check:csp
```

Production deploys from `main` through CI, which builds `dist/` and deploys it
with the Worker. Do not deploy `dist-e2e/` or `dist-e2e-do/`, which contain a
test issuer. Keep `dist-preview/` and preview's custom domain separate.

## Verify and observe

Check these before declaring success:

- `/api/network/enroll` and `/api/network/session` succeed for valid devices,
  and the session carries Cloudflare ICE servers.
- `npm run verify:production` passes (HSTS, TURN health).
- `/api/realtime/control`, `/api/realtime/lobby/peerly-lobby-v1`, and authorized
  `/api/realtime/content/<route>` upgrades succeed.
- `/api/rendezvous/presence` issues a token-free certificate;
  `/api/rendezvous/verify` rejects tampering, expiry, and other origins.
- Two accounts exchange messages. A fresh browser receives the channel
  definition and recent history while the original devices are offline.
- Channel deletion remains deleted after stale-device resync. Metadata is
  retained independently of the rolling history budget (1,000 events per
  workspace/DM object, 30 days). Current state has a 1,000-entity bound,
  including deletion records; reaching it returns an error, never eviction.
- A lost ACK leaves a visible, persistent pending message. Reload and retry
  keep the same message ID and produce one logical message.
- Revocation closes content/lobby sockets before the server ACK. A failed
  request remains visible and queued through reload/reconnect.
- Files and calls work between separate networks.
- Storage failure shows a warning and unsaved in-memory history can be
  exported before the tab is closed. The pending-message outbox uses IndexedDB.

Watch auth errors, upgrade errors, ACK latency, reconnects, revocation errors,
state-capacity responses, TURN health, and DO usage. Logs must omit provider
tokens, email claims, room secrets, and message contents.

## Rollback

Restore the browser and runtime together: `VITE_CONTENT_BACKEND=p2p` (or
unset) during `npm run build`, and `CONTENT_BACKEND=p2p` in the Worker.
Signaling stays on Durable Objects.

Deploy that matched artifact/configuration and verify fresh and existing
browser sessions. Keep DO bindings and applied migration history intact;
rollback does not require deleting namespaces or stored content. Recent
DO-only history is not automatically copied into offline P2P browsers, so
preserve the namespaces and explain any temporary history-availability gap.
Never roll back to a token-broadcasting client.
