# Peerly

Encrypted hybrid team collaboration. Every deployment signals through a Cloudflare Worker with Durable Objects. Production (`peerly.cc`) keeps messages peer to peer; `preview.peerly.cc` also keeps encrypted channel state and recent chat history in Durable Objects. File bodies and video calls use WebRTC in both. Built with [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/) + [DaisyUI](https://daisyui.com/), [Cloudflare Workers](https://workers.cloudflare.com/), and [Trystero](https://github.com/dmotz/trystero). See the [cutover runbook](docs/DURABLE_OBJECTS_CUTOVER.md) for rollout and rollback.

Highlights: the reusable P2P and Durable Objects primitives ship as the npm package [`@peerly/core`](packages/core), while Peerly owns its product-specific authorization and event policies. The app also includes messenger attention, signed message actions, rich file/call workflows, channel management, an installable offline shell, URL routing, complete English/Polish UI, and accessibility hardening. The running app always shows its exact version and commit in the UI.

**Live app:** [peerly.cc](https://peerly.cc)

Per-screen behavior, routes, and major functions:
**[docs/views.md](docs/views.md)**.

## Features

- **Invite-only workspaces** — a high-entropy workspace ID in the URL fragment doubles as the room encryption secret; share the full signed invite to grant access
- **Multiple workspaces** — joined workspaces are remembered per browser; sign in once, pick a workspace from the join screen, and switch later without the invite link
- **Workspace appearance** — rename a workspace and upload a custom icon from workspace settings; stored locally per browser and shown in the sidebar and picker
- **Light and dark themes** — follows the operating-system preference by default and stores an explicit choice per device
- **Identity separate from workspace** — leave a workspace without losing your identity; return to the picker while remaining signed in
- **Verified identity** — sign in with Google, Microsoft, Apple, or generic OIDC; the Worker verifies enrollment and peers verify each other's identity in their handshake
- **Creator-signed allow-list** — only invited email addresses can join; the exact signed revision is enforced by the Durable Object authorization boundary and by peer handshakes in P2P mode
- **Creator-only invites** — only the device that created a workspace can add members to the allow-list; anyone can copy the invite link
- **Device-bound auth** — ECDSA challenge-response prevents replayed identity tokens
- **Session continuity** — warns before the current ID token expires and offers same-account reauthentication so new peer handshakes keep working
- **Managed channels & DMs** — client-encrypted, persisted message/reaction streams with channel rename/delete/reorder and locally closable DM threads; P2P remains a selectable backend
- **Reader-friendly history** — incoming messages do not pull you away from older history; a new-message pill returns to the latest messages
- **Messenger attention** — unread totals update the tab title and favicon; users can explicitly opt into background DM notifications and local attention sounds, including an incoming-call ringtone
- **Signed message actions** — HTTPS links are safely linkified; authors can edit/delete with signed revisions, and reactions carry their own identity-bound signatures
- **Fast file input** — attach multiple files, paste clipboard images/files, or drag files onto the composer; selections process sequentially to cap peak memory
- **Progressive file sync** — text and thumbnails sync first; full-size file bodies download on demand by default, with a device-wide automatic mode available
- **Storage visibility** — approximate browser quota, available space, pressure warnings, per-workspace usage, and separate actions for freeing cached originals or clearing local history
- **Workspace backups** — exports signed workspace-channel history and access as JSON, then safely merges it back from the workspace picker
- **Local sensitive-media screening** — NSFWJS checks image/video attachments and samples remote video streams locally; flagged media stays hidden until revealed
- **Video calls** — incoming-call awareness, screen sharing, camera/microphone selection, and WebRTC media relayed through Cloudflare TURN on strict networks
- **Installable offline shell** — a service worker caches the production app shell and loaded release assets so local history remains reachable without signaling
- **English and Polish UI** — the device language preference covers navigation, settings, chat, files, calls, storage, invites, confirmations, placeholders, and accessibility labels
- **Approved-device sync** — the My Devices screen uses mutual, fingerprint-confirmed approval to link a second signed-in device; allowlisted local data then merges directly while both devices are online, and approved devices can sign edits/deletes of the account's earlier messages
- **Visible P2P transfers** — the Sync activity tab shows metadata-only sent/received events, transfer sizes, data categories, and the known friend, workspace member, peer, or approved device involved; message bodies and secrets are never logged
- **Accessibility hardening** — deterministic view focus, polite incoming-message announcements, clearer light-theme contrast, and motion-aware navigation
- **Connectivity diagnostics** — distinguishes local WebRTC availability, a verified peer connection, signaling failure, and paths that need TURN
- **Build stamp** — version and git commit shown in the UI so you can confirm what is deployed

## Quick start

Requires **Node 24.x and npm 11.x** — the majors that wrote the lockfile. Majors are what matter: different npm MAJOR releases can rewrite optional dependency records incompatibly, while patch releases do not. Exact-patch pins were tried and abandoned twice — they turn any tool-mirror gap into a failed install (Cloudflare's builder could not fetch one specific patch and every deploy failed).

```bash
nvm install 24
nvm use 24
npm --version            # must print 11.x
git clone https://github.com/codefusion-cc/peerly.git
cd Peerly
npm ci
cp .env.example .env   # add at least one identity provider (see below)
npm run dev
```

Open the printed URL in two browser tabs (or share an invite link). Peers connect in a few seconds over public Nostr signaling, because the Vite dev server has no Worker to signal through. `npm run stop` kills the common dev ports.

### First-time flow

1. **Sign in** with a configured identity provider.
2. **Create a workspace** (name + initial member emails) or **join** via an invite link (`#invite=…` in the URL).
3. Share the invite link from the sidebar; only the creator's device can add more emails to the allow-list.

The workspace secret never appears in the UI — it lives only in the invite link fragment and local storage.

### Sync and browser storage

The default **on-demand** mode is designed for fast joins and constrained browser storage:

1. Channel and message history syncs first.
2. File metadata and small WebP thumbnails travel with history.
3. Full-size file bodies download only when opened.

Workspace settings can enable **Auto-download full files** for every workspace on that device. Automatic downloads pause when browser storage reaches warning or critical pressure; text and metadata sync keep working. The storage card uses `navigator.storage.estimate()`, so quota and available-space values are approximate and browser-specific.

Storage actions are local:

- **Free local space** removes reclaimable cached originals while retaining messages, previews, and the metadata needed to request files again.
- **Clear local history** removes that workspace's messages, previews, read state, and cached bodies that no other local workspace references while retaining workspace access.

Neither action deletes content from other members. In production P2P mode, re-sync requires a peer holding the relevant history or file body. DO preview can replay recent encrypted history without an online peer: up to 1,000 chat/reaction events per workspace or DM object for 30 days. Channel definitions and deletion records have separate durable storage. File originals still require a peer. Pending outgoing messages are kept in a local IndexedDB outbox until delivery and local persistence succeed.

**Export backup** in workspace settings saves the newest 500 messages from each workspace channel together with channel structure and signed workspace access. Protect the JSON like an invite link. Imports verify the creator-signed allow-list and message signatures, bound untrusted data, and merge without overwriting local messages. DMs and full-size file bodies are excluded.

### Sensitive-media screen

NSFWJS and its MobileNetV2 model are loaded lazily only when visual media needs checking. Peerly serializes classification and backs off live-video sampling after clean frames; sampled frames are neither uploaded nor persisted. Shared images, video-file samples, and visible remote video streams can be blurred behind a reveal action.

This is a receiver-side privacy aid, not moderation or access control. Classification deliberately fails open when the model or browser graphics backend is unavailable, and a modified peer can bypass its own outbound checks.

## Identity providers (required for production)

Workspace access is decided by the **verified email** on an ID token, so a
provider only works here if it (a) issues a signed OIDC ID token in the browser,
(b) includes the user's email, (c) asserts that email is verified, and (d)
supports `nonce` (which binds the token to your device key). Set **at least one**
in `.env`, then restart the dev server.

| Provider | Variables | Notes |
|----------|-----------|-------|
| Google | `VITE_GOOGLE_CLIENT_ID` | Simplest. Works out of the box. |
| Microsoft | `VITE_MICROSOFT_CLIENT_ID`, `VITE_MICROSOFT_TENANT_ID` | Tenant is **required**; needs `email` + `xms_edov` optional claims. |
| Apple | `VITE_APPLE_CLIENT_ID`, optional `VITE_APPLE_REDIRECT_URI` | Needs a Services ID + verified domain. |
| Generic OIDC | `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_ISSUER`, optional `VITE_OIDC_LABEL` | IdP must allow implicit `id_token` for a SPA. |

### Google

1. [Google Cloud console](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client ID → Web application**.
2. **Authorized redirect URIs**: `https://<origin>/api/auth/google/callback` for every origin that serves the Worker (`https://peerly.cc`, `https://preview.peerly.cc`). Sign-in is a full-page redirect ([`@codefusion-cc/google-sign-in`](https://www.npmjs.com/package/@codefusion-cc/google-sign-in)): no Google script and no FedCM, so it also works in embedded browsers.
3. Configure the OAuth consent screen (External is fine; while in *Testing* only listed test users can sign in).
4. Copy the client ID → `VITE_GOOGLE_CLIENT_ID`.

The token's nonce names the device key (`<deviceKeyId>.<random>`), and every use of it comes with a signature by that key, so peers and the Worker accept it for 30 days after Google issued it (`src/auth/deviceToken.ts`), not just Google's hour. A page load with a Google token over three days old, or one under a key Google withdrew, asks Google again without a prompt, at most once a day; while the person stays signed in to Google they never see a sign-in again. Otherwise the workspace banner offers one before the 30 days end.

### Microsoft

1. [Entra portal](https://entra.microsoft.com) → **App registrations → New registration**.
2. **Supported account types**: *Accounts in this organizational directory only*. Multi-tenant is refused at startup — see the security note below.
3. **Redirect URI**: platform **Single-page application**, value = your exact origin (`http://localhost:5173`, and your production origin).
4. **Authentication → Implicit grant**: tick **ID tokens**.
5. **Token configuration → Add optional claim → ID** → add both **`email`** and **`xms_edov`**.
6. Copy *Application (client) ID* → `VITE_MICROSOFT_CLIENT_ID`, and *Directory (tenant) ID* → `VITE_MICROSOFT_TENANT_ID`.

Step 5 is not optional. Azure never emits the standard `email_verified`; `xms_edov`
("email domain owner verified") is its equivalent, and without it no Microsoft
user can be admitted. Step 2 matters because Azure lets a tenant admin set an
account's `email` to any unverified value — with multi-tenant, anyone could
register a free tenant, assert one of your members' addresses, and walk in
(Microsoft's documented ["nOAuth"](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference) abuse). Pinning one tenant reduces that to
"an admin of your own directory", who you already trust.

### Apple

1. [Apple Developer](https://developer.apple.com/account/resources/identifiers/list/serviceId) → **Identifiers → Services IDs** → create one (e.g. `com.example.peerly`).
2. Enable **Sign in with Apple**, then **Configure**: add your domain and a **Return URL** matching your origin. Apple requires a verified domain and **does not accept `localhost`** — for local dev use a tunnel, or just use Google.
3. Services ID → `VITE_APPLE_CLIENT_ID`; set `VITE_APPLE_REDIRECT_URI` if it differs from `window.location.origin`.

### Generic OIDC (Okta, Auth0, Keycloak, Entra ID as OIDC, …)

1. Create a **SPA / public client** in your IdP.
2. Allow **implicit `id_token`** and the `openid profile email` scopes; redirect URI = your origin.
3. Ensure the ID token carries `email` **and** `email_verified` — the app rejects tokens without a verified email.
4. `VITE_OIDC_ISSUER` = the issuer URL (the app reads `<issuer>/.well-known/openid-configuration`), `VITE_OIDC_CLIENT_ID` = the client ID.

### Why GitHub is not supported

GitHub does not implement OIDC for user sign-in. Its
[discovery document](https://github.com/login/oauth/.well-known/openid-configuration)
advertises `claims_supported: [sub, aud, exp, nbf, iat, iss, act]` — **no `email`
and no `nonce`** — and there is no `userinfo_endpoint`. Its plain OAuth returns an
*opaque* access token instead, which a peer cannot verify without a server (and
only by handing that server the token). Both are load-bearing here, so GitHub
cannot be supported without changing the trust model. It was removed rather than
left as a button that always fails.

## Signaling

Browsers need a **signaling channel** to discover each other for P2P file and
media flows. Message content uses a separately selected backend:

| Content mode | Behavior | Config |
|---|---|---|
| **Durable Objects** (preview) | Encrypted messages, reactions, and channel definitions are persisted before fan-out; late joiners receive bounded history | `VITE_CONTENT_BACKEND=durable-objects` and `CONTENT_BACKEND=durable-objects` |
| **P2P** (production default) | Messages and history move directly between currently connected browsers | `VITE_CONTENT_BACKEND=p2p` and `CONTENT_BACKEND=p2p` |

Files and call media remain P2P in both modes.

| Mode | When | Config |
|------|------|--------|
| **Durable Objects** (default) | Every build served by the Worker, production and preview | None |
| **Nostr** | `npm run dev`, which has no Worker | `VITE_SIGNALING=nostr`, optional `VITE_NOSTR_RELAYS` |
| **Supabase** | Development against a Supabase project | `VITE_SIGNALING=supabase` + Supabase URL/key |

`VITE_NOSTR_RELAYS` replaces the dev server's curated Nostr relays. Members need at least one relay in common, so relay choice is build-time configuration, not a user setting.

### Durable Objects control plane

The Worker ([`worker/index.mjs`](worker/index.mjs), shared code in [`packages/core/worker/realtime`](packages/core/worker/realtime)) handles device enrollment, session cookies, presence, workspace and DM notifications, WebRTC signaling and ICE servers under `/api/network/*` and `/api/realtime/*`. Its Durable Objects are `UserGatewayDO`, `SignalScopeDO`, `ContentChannelDO` and `LobbyChannelDO`. With `CONTENT_BACKEND=durable-objects` the browser encrypts messages, reactions and channel definitions with the workspace or DM secret, and the server persists only ciphertext and bounded routing metadata before broadcasting it. File bytes and calls stay WebRTC peer to peer.

[`wrangler.jsonc`](wrangler.jsonc) (production) and [`wrangler.preview.jsonc`](wrangler.preview.jsonc) (preview) differ only in `CONTENT_BACKEND`, names and migration history. Both require the secrets `RENDEZVOUS_SECRET`, `NETWORK_SESSION_SECRET`, `OPAQUE_USER_ID_SECRET`, `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`. A client pointed at an unconfigured Worker fails closed with `503`, and a stale or invalid capability fails with `400`/`401`.

When a Durable Object restarts, for example on every deploy, an open room's scope socket reopens by itself after 1, 2, 5 and 10 seconds, then every 30 seconds, with jitter. Peers that are already connected keep talking directly meanwhile.

`npm run deploy:preview` deploys `peerly-preview` through `wrangler.preview.jsonc`, whose build writes `dist-preview/`, so a preview deploy never touches production's `dist/`. It runs from the Mac through the CodeFusion Console CLI rather than `wrangler login`, whose token reaches the whole account:

```bash
cd /Users/xeon/Projects/Peerly && codefusion-console cloudflare workers:edit,domains:edit -- npm run deploy:preview
```

`codefusion-console cloudflare <scope>[,<scope>…] [--ttl 30m] -- <command>` mints a token with exactly those scopes for that one command (two hours by default), hands it over as `CLOUDFLARE_API_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`, and deletes it when the command exits; a token with an `:edit` scope waits for the owner's passkey tap on Dispatch. The preview deploy needs `workers:edit` and `domains:edit` (its `preview.peerly.cc` custom domain); its secrets (`codefusion-console cloudflare workers:edit -- npx wrangler secret put <NAME> -c wrangler.preview.jsonc`) need `workers:edit`. Once per Mac: `npm install -g @codefusion-cc/console && codefusion-console relay install`.

Peerly's Worker and Durable Objects come from `packages/core/worker/realtime` and [`packages/core/src/realtime`](packages/core/src/realtime). That core is being replaced step by step by the shared `@codefusion-cc/realtime` packages HeyHubs already runs. [docs/DURABLE_OBJECTS_ARCHITECTURE.md](docs/DURABLE_OBJECTS_ARCHITECTURE.md) has the current design.

`npm run test:e2e` and `npm run test:e2e:do` drive it the way a user would: each builds the app, serves the build from the real Worker on localhost with real Durable Objects, and runs browser contexts against it, with peer-to-peer content and Durable Objects content respectively. Test-only sign-in there is configuration: a generic `oidc` provider whose JWKS is served from the build, set only in [`wrangler.e2e.jsonc`](wrangler.e2e.jsonc). A deployment that sets none of those variables resolves the provider to `null` and the route answers `503`, so it cannot be switched on by accident.

[docs/REWRITE_ARCHITECTURE.md](docs/REWRITE_ARCHITECTURE.md) records how this was built and the invariants it must keep; [docs/DURABLE_OBJECTS_CUTOVER.md](docs/DURABLE_OBJECTS_CUTOVER.md) covers rollout and rollback.

### TURN

Calls use Cloudflare Realtime TURN through [`@codefusion-cc/realtime-media`](https://www.npmjs.com/package/@codefusion-cc/realtime-media). The Worker holds a TURN key (`TURN_KEY_ID`, `TURN_KEY_API_TOKEN`), provisioned through CodeFusion Console and never set by hand. Each control session response from `/api/network/session` carries `ice: { servers, ttlMs }`: Cloudflare STUN plus TURN credentials valid for one hour (the browser counts `ttlMs` on its own clock), renewed at every session refresh ([`worker/realtime/ice.mjs`](worker/realtime/ice.mjs)). Without a key, or when Cloudflare's API fails or takes longer than 3 seconds, the session gets Cloudflare STUN only and the Worker logs the failure.

The browser accepts only Cloudflare's own STUN and TURN URLs, drops TURN a minute before it expires, and gives peers created later the renewed credentials.

Two checks catch a key that stopped working: a cron every five minutes, and the public, rate-limited `GET /api/media/health`. `npm run verify:production` checks HSTS and that endpoint; CI runs it after every production deploy. Browser tests on one host connect over host candidates, so they never exercise TURN itself.

## Deploy

Peerly's UI is a static SPA served by its Worker, which also answers the
authenticated `/api/network/*` and `/api/realtime/*` routes the client signals
through.

```bash
npm run build
```

Output goes to `dist/`. The build runs a bundle guard that fails if E2E test key material, a retired static credential, or a hostname of the retired self-hosted relay or TURN server reached the bundle.

### Cloudflare Workers Static Assets (recommended)

The committed [`wrangler.jsonc`](wrangler.jsonc) deploys `dist/` with an SPA fallback and runs `worker/index.mjs` first for `/api/*` requests. All other requests keep the static-assets-first path.

GitHub Actions deploys it: every push to `main` that passes the `test` job runs
the `deploy` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
(environment `production`, one deploy at a time, never cancelled). It runs
`npm run build` with the Google client ID, the only build-time variable
production needs, then `npx wrangler deploy`, waits until peerly.cc serves the
new entry script, and runs `npm run verify:production`. Branches are not deployed; test them on
preview.peerly.cc (below). The build shows `GITHUB_SHA` in the UI as
`v<version> · <commit>`.

The deploy needs a `CLOUDFLARE_API_TOKEN` secret in the GitHub environment
`production` (Settings → Environments) with Workers Scripts Edit on the account
that holds the `peerly` Worker. Cloudflare Workers Builds, still configured on
the Worker, lost its GitHub connection when the repository moved to
codefusion-cc and deploys nothing.

Register the production origin (`https://peerly.cc`) in each OAuth provider's allowed JavaScript origins / redirect URIs.

### Testing branches with Google sign-in

Google accepts only exact redirect URIs, not a wildcard for Cloudflare's
per-branch URLs. Set `VITE_GOOGLE_CALLBACK_ORIGIN` on preview builds to a
stable origin whose Worker takes Google's redirect (`https://preview.peerly.cc`).
That Worker hands the token on only to the login page of an origin
`allowedAuthParent` in `worker/index.mjs` accepts, and the preview still
verifies the token and its device-key nonce itself. Without the variable each
origin takes its own redirect.

### CodeFusion Console

Both Workers report to [CodeFusion Console](https://console.codefusion.cc) as the app `peerly`: it reads every invocation as their tail consumer (Failures, Health, Logs), and each build serves `/version.json` with its version and commit (Deployments). The console reaches the production Worker through its `ConsoleAdmin` entrypoint ([`worker/console/`](worker/console)), a service binding with no public address. Its manifest lists the Worker secrets Peerly needs and how each value is made: random keys, and a Cloudflare Realtime TURN key for `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`. The console's Secrets page shows which are missing in production and staging and makes new values, never showing one; from a shell:

```bash
codefusion-console secrets peerly
```

`codefusion-console provision_secrets peerly production cloudflare-turn-key` (or `staging`) creates a TURN key and writes both TURN secrets of that Worker once the owner approves it on Dispatch.

## Tech stack

| Layer | Choice |
|-------|--------|
| UI | React 19, Tailwind CSS 4, DaisyUI 5 (custom `peerly` light and `peerly-dark` themes) |
| Build | Vite 8, TypeScript 6 |
| Realtime | Cloudflare Workers and Durable Objects for signaling, Cloudflare Realtime TURN, Trystero (`@trystero-p2p/*`) with Nostr or Supabase signaling in development |
| Crypto | Web Crypto — ECDSA device keys, JWT verification via JWKS, creator-signed allow-lists |
| Storage | localStorage (session, workspace list, messages, indexes), IndexedDB (device keys, file bodies, avatars) |
| Media safety | Lazy NSFWJS MobileNetV2 inference in the browser |
| Tests | Vitest (unit), Playwright (E2E), oxlint |

## @peerly/core

The generic P2P room core — room-code generation, signaling strategy selection,
`joinRoomByCode`, the `useRoom` React hook, device identity, signing
primitives, browser-side OIDC verification, room media, attention helpers, and
shared avatar/IDB utilities — lives in [`packages/core`](packages/core) and is
published to npm as [`@peerly/core`](packages/core/README.md) (see that README
for the API surface; do not pin a version in prose here). The app consumes it
from source via a Vite/tsconfig alias; consumer apps use the published package.
Workspace semantics — creator-signed allow-lists, peer
handshakes, history sanitization — deliberately stay in the app, not the
package. Releases run through the `release-core.yml` workflow: manual trigger,
npm Trusted Publishing with provenance, automatic version bump via release PR.

## Project structure

```
.
├── e2e/                    Playwright end-to-end tests
├── docs/                   views.md (screens & functions), implementation notes
├── public/                 Static assets (favicon, etc.)
├── scripts/
│   ├── guard-bundle.mjs    Fail build if E2E keys or retired hostnames reached dist/
│   ├── emit-e2e-jwks.mjs   Publish the E2E issuer's JWKS into dist/ (E2E only)
│   ├── check-csp.mjs       Serve dist with CSP, test a negative control + offline shell
│   ├── check-relays.mjs    Nostr relay health diagnostic
│   └── verify-production.mjs  HSTS and Cloudflare TURN health of a deployment
├── server/                 Dev and test servers, process helpers
│   ├── dev.mjs             npm run dev (Nostr signaling)
│   └── test-server.mjs     E2E: built app behind the real Worker + Durable Objects (p2p or durable-objects content)
├── src/
│   ├── collab/             P2P protocol, crypto, identity, stores
│   ├── components/         React UI (join, settings, storage, chat, files, video)
│   ├── hooks/              Room, collab, auth wiring
│   ├── protocol/           Message types & mappers
│   ├── utils/              Storage, blobs, hashing
│   ├── index.css           Tailwind + DaisyUI theme
│   ├── App.tsx             Session bootstrap, workspace routing
│   ├── config.ts           Room / signaling / build label
│   └── session.ts          Active workspace session persistence
├── build-info.mjs          Version + commit injected at build time
├── .env.example            Environment template (copy to .env)
├── .nvmrc                  Node 24.18.0 (npm 11.16.0 / CI alignment)
├── playwright.config.ts    Browser suite against production's shape (serial)
├── playwright.do.config.ts Durable Objects browser suite (own target, serial)
├── vite.config.ts
├── wrangler.jsonc          Production (peerly.cc): Durable Objects signaling, p2p content
├── wrangler.preview.jsonc  Preview (preview.peerly.cc): Durable Objects content too
├── wrangler.e2e.jsonc      Local-only DO target for the browser suite
└── vitest.config.ts
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite + public Nostr signaling |
| `npm run dev:app` | Vite only, using the signaling strategy from the environment |
| `npm run stop` | Stop the common local Peerly development ports |
| `npm run build` | Typecheck + production build + bundle guard |
| `npm test` | Vitest unit/component tests (counts change with the suite — run `npm test` for the current total) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc -b` across every project (the root config is solution-style, so `tsc -p` alone checks nothing) |
| `npm run test:workers` | Durable Object behaviour against real workerd |
| `npm run test:e2e` | Playwright E2E against the real Worker and Durable Objects, p2p content |
| `npm run test:e2e:do` | The same with Durable Objects content |
| `npm run test:e2e:ui` | Playwright interactive UI |
| `npm run verify:production` | Check a deployment's HSTS and Cloudflare TURN health (`PRODUCTION_SITE_URL`, default peerly.cc) |
| `npm run preview` | Preview the production build locally |
| `npm run check:relays` | Health-check the default Nostr relays |
| `npm run check:csp` | Verify production CSP, its inline-script negative control, and the offline shell |
| `npm run guard:bundle` | Fail if test key material or retired hostnames reached `dist/` (runs in `build`) |
| `npm run lint` | oxlint |

The app shows its version and commit (`v<version> · <commit>`) on the join screen and
in the sidebar footer. Hosts that expose a commit SHA
(`CF_PAGES_COMMIT_SHA`, `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`, …) are picked up
automatically; otherwise it falls back to local git.

`check:relays` is a diagnostic, not part of `npm test` — a third-party relay
going down shouldn't fail your build. Run it after editing
`DEFAULT_NOSTR_RELAYS`: a relay that merely opens a socket can still silently
drop the ephemeral events Trystero signals with, which looks identical to
working until two peers fail to find each other.

## Security model

- **Invite link = credential** — workspace ID lives in the URL hash (never sent to servers in HTTP requests)
- **Identity and membership** — enrollment verifies OIDC and a live device-key challenge; workspace content authorization verifies the creator's exact signed allow-list and derives opaque deployment-scoped member IDs
- **Server-side enforcement without plaintext identity storage** — Durable Objects receive opaque member IDs and a monotonic signed-list fingerprint, close revoked sockets, and never receive raw invited emails
- **Messages are author-signed** — every message and file announcement is signed with the sender's device key at send time. Signed v2 revisions make edits/deletes tamper-evident, and each reaction is signed independently. Relayed history is verified on import: tampered entries are dropped, and identity claims are honoured only for keys bound to that user in a live handshake.
- **Device approval is explicit** — sharing an account login does not grant one device authority over another device's messages. Both devices must confirm a one-time pairing, exchange reciprocal signed grants, and retain those grants locally. Continuous sync is peer-to-peer and only runs while approved devices are simultaneously online; account sessions and identity tokens are never copied.
- **Security headers** — a strict Content-Security-Policy ships via `public/_headers`; CI serves the production bundle with those headers, asserts zero startup violations, and proves its negative control is blocked.
- **Inviting is creator-only** — the allow-list is only accepted if it verifies against the workspace's creator key, and that key never leaves the browser profile that created the workspace. A second device, even the creator's, cannot add members.
- **Revocation is monotonic in Durable Objects mode** — a newer creator-signed allow-list replaces the previous authority and removed members' live sockets are closed; with peer-to-peer content, revocation is learned from peers and so eventual
- **Live messages** — attributed by transport peer id, not payload `senderId`
- **Legacy history** — unsigned entries from older versions retain readable text but lose durable identity claims; newly authored entries are signed and verified
- **Local media classification** — sensitive-media screening never uploads frames, but it is advisory and fails open rather than acting as a moderation authority
- **Connection metadata** — signaling never carries file bodies, and in production not message bodies either, but Cloudflare as signaling and TURN operator can still observe connection metadata such as IP addresses, timing, and traffic volume
- **Production bundle guard** — E2E fake-issuer keys are isolated and scanned out of `dist/` on every build

## Design limits

Hybrid storage and transport trade-offs:

- **Durable history is bounded** — encrypted event envelopes retain for at most 30 days and the latest 1,000 events per workspace or DM; this is reliable delivery and recent history, not a permanent archive
- **File availability remains peer-owned** — metadata can outlive an online sender, but file bodies live in local copies and transfer only while a member holding the content is reachable
- **Transfers are whole-file** — file bodies are content-addressed and integrity-checked; resumable byte-range transfer is traded away for that simplicity, and join progress is channel-based rather than byte-accurate.
- **Peer-to-peer revocation is eventual** — a removed member stops being admitted as devices learn the newer creator-signed list; Durable Objects mode closes existing revoked sockets immediately after accepting a newer signed authority revision
- **Calls on strict networks need TURN** — without a working TURN key a session gets STUN only, and peers behind strict NAT or firewalls cannot reach each other until the key works again
- **Moderation stays on your device** — local NSFW screening is advisory; the server holds ciphertext without the workspace/DM key and therefore cannot inspect content

## CI

GitHub Actions on push/PR to `main` / `master` (see [.github/workflows/ci.yml](.github/workflows/ci.yml)):

1. Install Node `24.18.0` with its bundled npm `11.16.0`, then verify both exact versions.
2. Run a clean `npm ci` from the committed lockfile.
3. Run the production audit, lint, unit and Worker tests, and coverage.
4. Run the TypeScript/Vite production build and bundle guard, then `worker:check`.
5. Install Chromium, verify CSP plus the offline shell, and run both Playwright suites against the real Worker and Durable Objects.
6. On `main`, after the mutation job, deploy production and run `npm run verify:production`.

`package.json` `devEngines`, `.npmrc`, `.nvmrc`, and CI all enforce the same toolchain. A mismatched Node or npm exits before it can rewrite `package-lock.json`.

## Legal

A Privacy Policy and Terms of Service ship with the app (EN/PL), reachable at
`/privacy` and `/terms` and linked from the join screen and workspace sidebar. A
first-run consent banner records agreement (versioned in
[`src/consent.ts`](src/consent.ts)), and the sign-in card shows an agreement
notice.

- English reference copies: [docs/legal/PRIVACY.md](docs/legal/PRIVACY.md),
  [docs/legal/TERMS.md](docs/legal/TERMS.md).
- In-app localized source of truth: [`src/legal/legalContent.ts`](src/legal/legalContent.ts).
- Controller name, contact addresses, jurisdiction, and minimum age live in
  [`src/legal/legalMeta.ts`](src/legal/legalMeta.ts). Edit there.

The invite allow-list distributes invited email addresses to workspace peers —
the Privacy Policy discloses this. These texts are a good-faith starting point,
not a substitute for review by a lawyer before a public/commercial launch.

## License

MIT — see [LICENSE](LICENSE).
