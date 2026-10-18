# Repo map

Peerly: encrypted team collaboration (workspaces, chat, files, video calls) as a React SPA. Peers talk over WebRTC and signal through a Worker with Durable Objects. Production keeps messages peer to peer; `preview.peerly.cc` keeps them in Durable Objects.
Per-screen behavior is in [views.md](views.md); several tabs of one browser in [two-tabs.md](two-tabs.md); DO design in [DURABLE_OBJECTS_ARCHITECTURE.md](DURABLE_OBJECTS_ARCHITECTURE.md); TURN, structure, deploy and CI in [README.md](../README.md).

## Layout

- `src/` the app. `App.tsx` session bootstrap and workspace routing, `routing.ts`, `config.ts` build config, `session.ts`, `i18n.tsx`, `updates.ts` (moves open tabs onto a new deploy).
- `src/auth/` sign-in: Google's redirect (`googleRedirect.ts`) and the device-bound token rule shared by page and Worker (`deviceToken.ts`).
- `src/collab/` app policy: workspace stores, creator-signed allow-lists (`allowList.ts`), message signing, identity providers, DM and friends stores, mesh (`mesh.ts`), sibling tabs and once-per-browser attention (`browserTabs.ts`).
- `src/components/` UI (join, workspace, chat, files, `VideoCall.tsx`), `src/hooks/` room, collab and auth wiring (`useCollab.ts`, `useRoom.ts`), `src/context/` collab context, `src/protocol/` message types and mappers, `src/realtime/content.ts` DO content client.
- `packages/core/` `@peerly/core`, no longer published: rooms, signaling, device identity, per-tab session keys (`tabSession.ts`), peer handshake (`peerIdentityHandshake.ts`), OIDC checks, media, the page's control client (`src/app/realtimeClient.ts`, `src/realtime/`), `worker/` (OIDC checks, rendezvous, the content and lobby channel classes and `SignalScopeDO` under `realtime/gateway/`). The app imports it from source through an alias. It shrinks with each step of the realtime plan and goes once Trystero does.
- `worker/index.mjs` the Worker for production and preview (API routes, assets, media health cron); `worker/realtime/` Peerly's DO classes (`gateway.mjs`: the `@codefusion-cc/realtime` gateway with Peerly's `commands/`; `lobbyChannel.mjs`, `contentChannel.mjs`), the sign-in token check (`identityProvider.mjs`) and Cloudflare TURN credentials (`ice.mjs`); `worker/testing/` test accounts and config readers; `worker/console/` the `ConsoleAdmin` entrypoint CodeFusion Console binds, and its manifest of Worker secrets; `worker/usageWatch.mjs` with `wrangler.usage-watch.jsonc`.
- `server/` dev server (`dev.mjs`, Nostr signaling) and E2E server (`test-server.mjs p2p|durable-objects`).
- `e2e/` Playwright specs, `scripts/` bundle and CSP guards, Nostr relay check, `verify-production.mjs`. `docs/` implementation notes.
- Configs: `wrangler.jsonc` (production, `CONTENT_BACKEND=p2p`), `wrangler.preview.jsonc` (staging, `CONTENT_BACKEND=durable-objects`; otherwise only names and migration history differ), `wrangler.e2e.jsonc`, `vitest.config.ts`, `vitest.workers.config.ts`, `playwright*.config.ts`.

## Main flows

- Sign-in: Google by full-page redirect (`src/auth/googleRedirect.ts`, `@codefusion-cc/google-sign-in`; the Worker serves `/api/auth/google/callback` and Google's keys at `/api/auth/google/jwks`), other providers by popup (`src/collab/providerSignIn.ts`). The token's nonce names the device key and it is accepted for 30 days after `iat` by the page, peers and the Worker (`src/auth/deviceToken.ts`, read by `packages/core/worker/oidc.mjs`); a page load quietly refreshes an aging Google token (`useSessionBootstrap`). Each tab adds an in-memory tab key the device key certifies; workspace handshakes (`src/collab/identityHandshake.ts`) prove possession with it, so tabs of one browser are distinct peers.
- Production chat: `src/hooks/useRoom.ts` -> `@peerly/core` `joinRoom` -> `SignalScopeDO` signaling (`packages/core/src/realtime/signaling.ts`) -> WebRTC peers; messages signed (`src/collab/messageSigning.ts`), stored in localStorage.
- Control plane: `/api/network/enroll`, `/api/network/session`, `/api/realtime/control` and `/api/realtime/logout` are `@codefusion-cc/realtime`'s `handleRealtimeRoute`; the account gateway is its `defineUserGateway` with Peerly's commands (`scope.request` for `SignalScopeDO`, `device.revoke`, preview content authorization). Identity certificates: `/api/realtime/identity`, `/api/identity/verify`. The page's control client is still `@peerly/core`'s.
- Session and ICE: `/api/network/session` -> session cookie plus `ice: { servers, ttlMs }` from `worker/realtime/ice.mjs` (Cloudflare STUN, one-hour TURN credentials). `/api/media/health` and the five-minute cron check the TURN key.
- Preview (DO content): `src/realtime/content.ts` -> `/api/realtime/*` -> `handleRealtimeRoute` -> `UserGateway`, lobby and content channel DOs (`worker/realtime/`) -> DO SQLite.
- Calls and files: `VideoCall.tsx` and `FilesPanel.tsx` over WebRTC, never through the Worker.

## @codefusion-cc packages

`app-update` (`src/updates.ts`: an open tab reloads onto a new deploy once no call, moving file transfer, changed field or write holds it, offering a refresh meanwhile; lazy pages whose chunks a deploy removed reload), `realtime` (the Worker's control plane: sign-in, sessions, the account gateway, identity certificates, channel session helpers), `realtime-media` (Cloudflare TURN credentials and the media health check) and `console`: the Worker's `ConsoleAdmin` (`worker/console/`), `/version.json` and the build identity (`build-info.mjs`, `vite.config.ts`), and the CLI (`codefusion-console cloudflare <scopes> -- <command>` for Cloudflare commands, `codefusion-console secrets peerly` for the Worker secrets). Both Workers' invocations go to the console as their tail consumer. Older shared code is still `@peerly/core` in `packages/core`, which HeyHubs no longer uses; Peerly moves onto `@codefusion-cc/*` packages step by step.

## Tests and checks

- Typecheck `pnpm run typecheck`; lint `pnpm run lint` (oxlint); build `pnpm run build` (also bundle, size and `guard:preview` guards: link-preview tags, `og-v1.jpg` and `robots.txt` in `dist/`; a new preview image gets a new file name).
- Unit (jsdom, `src/`, `packages/core/src`, `worker/**/*.test.mjs`): `pnpm test -- --maxWorkers=2`. Worker (workerd, `*.workers.test.*` in `packages/core/worker/realtime` and `worker/`): `pnpm run test:workers`; `pnpm run worker:check` after changing a wrangler config. `worker/realtime/legacySessions.workers.test.mjs` holds capabilities and cookies minted before the control plane moved to the package: if it goes red, a deploy would sign devices out.
- E2E (Playwright): `pnpm run test:e2e` and `pnpm run test:e2e:do` (built app behind the real Worker and DOs, p2p and DO content), `pnpm run test:a11y`. `test:mutation` (incremental) is a CI gate the deploy waits for; the weekly full re-test is in `security.yml`.
- CI (`.github/workflows/ci.yml`) also runs audit, coverage, `check:csp` and mutation testing (the deploy needs it).

## Deploy and migrations

- Merge to `main`: the `deploy production` job in `ci.yml` builds, runs `wrangler deploy` to https://peerly.cc, checks the served entry script and runs `pnpm run verify:production` (HSTS, TURN health).
- Staging `preview.peerly.cc` is manual: `codefusion-console cloudflare workers:edit,domains:edit -- pnpm run deploy:preview` (README "Durable Objects control plane"). Output goes to `dist-preview/`.
- DO migrations live in each wrangler config with its own history; there is no SQL database.

## Gotchas

- `VITE_APP_ID=peerly` is needed for vite, tsc and tests; use the package scripts (`pnpm run`), not bare `pnpm exec`.
- `pnpm run dev` signals through public Nostr: the Vite dev server has no Worker. Use the E2E servers to exercise the Durable Objects path.
- TURN secrets (`TURN_KEY_ID`, `TURN_KEY_API_TOKEN`) are provisioned through CodeFusion Console, never set by hand.
- Workspace semantics (allow-lists, handshakes, history sanitization) stay in `src/collab`, not in `packages/core`. Generic code goes to the package.
- Node 24 and pnpm 12.14.0 (`packageManager`) are enforced (`devEngines`, `engineStrict` in `pnpm-workspace.yaml`, CI); a mismatch exits early.
- Google sign-in on branch previews needs `VITE_GOOGLE_CALLBACK_ORIGIN` (README "Testing branches with Google sign-in"), and every origin's `/api/auth/google/callback` registered with the Google client.
