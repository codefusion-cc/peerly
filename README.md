# Peerly

Team chat in invite-only workspaces. Messages go directly between the members' devices, end-to-end encrypted;
the server signs people in, lets only the people a workspace lists in, introduces devices to each other and,
for a workspace whose owner has **Premium**, keeps its encrypted history and relays connections that cannot go
direct.

**Live app:** [peerly.cc](https://peerly.cc) · staging: [preview.peerly.cc](https://preview.peerly.cc)

Built on the shared CodeFusion packages: [`@codefusion-cc/realtime`](https://www.npmjs.com/package/@codefusion-cc/realtime)
(sign-in sessions, account gateways, linked devices, authorized channels, membership),
[`@codefusion-cc/realtime-p2p`](https://www.npmjs.com/package/@codefusion-cc/realtime-p2p) (the WebRTC data mesh),
[`@codefusion-cc/realtime-media`](https://www.npmjs.com/package/@codefusion-cc/realtime-media) (TURN credentials and
call budgets), [`@codefusion-cc/google-sign-in`](https://www.npmjs.com/package/@codefusion-cc/google-sign-in),
[`@codefusion-cc/theme`](https://www.npmjs.com/package/@codefusion-cc/theme),
[`@codefusion-cc/console`](https://www.npmjs.com/package/@codefusion-cc/console) and
[`@codefusion-cc/app-update`](https://www.npmjs.com/package/@codefusion-cc/app-update). Peerly holds its product:
the workspace and content model, its screens and copy.

How it works: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** · what Premium adds and how staff grant it:
**[docs/PREMIUM.md](docs/PREMIUM.md)**.

## What it does

- **Workspaces only listed people can enter.** The owner's account key signs the list of email addresses; the
  Worker checks the signature and compares keyed hashes of emails, never keeping the addresses. The invite link
  carries the workspace's secret in its fragment, which no server sees.
- **Peer to peer by default.** Members' devices pass signed, encrypted changes (messages, edits, deletions,
  reactions, channels) over WebRTC, and catch each other up when they meet. Nothing anyone writes is kept on the
  server.
- **Files** go peer to peer too: attach from the paperclip, a paste or a drop (up to 10 a message, 100 MB each);
  images show their preview at once and arrive by themselves, any file is saved exactly as sent, checked by its
  SHA-256.
- **Premium** keeps an owner's workspaces' encrypted history (latest 5,000 changes) and files (sealed on the
  device, up to 5 GB a workspace, in R2) so members get them whenever they come back, and gives the account
  Cloudflare TURN relays. Staff grant it from CodeFusion Console.
- **Channels** with replies, reactions, edits and deletions, safe HTTPS links, typing, presence and direct-link
  status; drafts per channel; keyboard first (Enter, Shift+Enter, ↑ to edit, Escape).
- **Linked devices** with a six-digit code compared on both screens; a linked device holds the account's keys.
- **Sign in** with Google, Microsoft (one tenant), Apple or any OpenID Connect provider.
- **English and Polish**, light and dark themes, phone to desktop, WCAG 2.2 AA checked by axe in the browser
  suite, an offline app shell, and a strict Content-Security-Policy.

Being ported from Peerly 1.x before 2.0 replaces it in production: calls (peer to peer, Premium through TURN and
the SFU), direct messages, unread attention and notifications, workspace backups and local media screening.

## Develop

```bash
npm ci
npm run dev
```

`npm run dev` ([scripts/dev.mjs](scripts/dev.mjs)) serves the page from Vite and runs the real Worker beside it
(`wrangler dev --local`, Durable Objects in `.wrangler/local-dev`), with secrets made for your checkout. It
offers a **test sign-in** (any email, loopback only) next to Google when `.env` sets `GOOGLE_CLIENT_ID` for an
OAuth client that allows `http://127.0.0.1:5173`. `--port`, `--host` and `--no-test-sign-in` change that.

## Sign-in providers

The Worker verifies every provider's ID token itself. Set the ones a deployment offers as Worker variables
(`vars` in [wrangler.jsonc](wrangler.jsonc)); each needs the redirect URI below registered with the provider.

| Provider | Variables | Redirect URI |
|----------|-----------|--------------|
| Google | `GOOGLE_CLIENT_ID` | `https://<origin>/api/auth/google/callback` |
| Microsoft | `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID` | `https://<origin>/api/auth/microsoft/callback` (Web platform, form post) |
| Apple | `APPLE_CLIENT_ID` (a Services ID) | `https://<origin>/api/auth/apple/callback` |
| OpenID Connect | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, optional `OIDC_LABEL` | `https://<origin>/api/auth/oidc/callback` |

- **Microsoft** must be one tenant: `common`, `organizations` and `consumers` are refused, because any tenant's
  admin can set an account's email to an address they do not own. Add the `email` and `xms_edov` optional claims
  to the ID token; `xms_edov` is how Microsoft says the email's domain is verified.
- **OpenID Connect** issuers must publish a discovery document and put a verified `email` in the ID token.
- **Previews** (`<branch>.preview.peerly.cc`) sign in through `preview.peerly.cc` (`AUTH_PREVIEW_PARENTS`), since
  providers accept no wildcard redirect URIs: register the staging origin only.

GitHub cannot be offered: it has no OpenID Connect sign-in with a verified email and a nonce.

## Deploy

Cloudflare Workers Builds deploys `main`: [wrangler.jsonc](wrangler.jsonc) as `peerly` (peerly.cc) and
[wrangler.preview.jsonc](wrangler.preview.jsonc) as `peerly-preview` (preview.peerly.cc), each with its own
secrets: `NETWORK_SESSION_SECRET`, `OPAQUE_USER_ID_SECRET` (never rotated: ids derive from it),
`TURN_KEY_ID` and `TURN_KEY_API_TOKEN` (a Cloudflare Realtime TURN key), and its R2 bucket for Premium files
(`peerly-files`, `peerly-files-preview`), which must exist before the deploy. Durable Object migrations apply with a
full deploy, so they reach production on merge. Branches get Worker previews.

The Worker reports to CodeFusion Console: its tail consumer, page failures and anonymous view counts
(`/api/browser-failures`, `/api/visits`), `version.json` and private source maps (`/_console/*`), and the
`ConsoleAdmin` entrypoint the console reaches over its `PEERLY_ADMIN` service binding.

## Checks

| Command | What it runs |
|---------|--------------|
| `npm run typecheck` | TypeScript for the page, the Worker and the tooling |
| `npm run lint` | oxlint |
| `npm test` | unit tests (Vitest) and the scripts' tests (`node --test`) |
| `npm run test:workers` | the Worker in workerd: sign-in, workspaces, ICE, the console admin |
| `npm run build` | the production build and `guard:bundle` (no test keys or static credentials ship) |
| `npm run worker:check` | Worker types are current and both configs deploy (dry run) |
| `npm run check:csp` | the build under the real CSP: no violations, the negative control blocked, the offline shell |
| `npm run test:e2e` | Playwright on the e2e build and the real Worker: two browsers chatting peer to peer, access, axe in both themes |

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs all of them.

## Legal

The Privacy Policy and Terms (English and Polish) are [src/legal/legalContent.ts](src/legal/legalContent.ts), shown
at `/privacy` and `/terms`; the controller and contacts are in [src/legal/legalMeta.ts](src/legal/legalMeta.ts).
`npm run legal:export` writes the English copies in [docs/legal](docs/legal), and a test fails when they differ.

## License

MIT — see [LICENSE](LICENSE).
