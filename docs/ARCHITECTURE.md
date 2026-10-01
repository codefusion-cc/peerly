# How Peerly works

Peerly 2.0 is a page (React, `src/`) and one Cloudflare Worker (`worker/`) with three kinds of Durable Objects,
built on `@codefusion-cc/realtime`. This is the map; each module's comment has the detail.

## Accounts and devices

- **Signing in** ([src/auth](../src/auth), [worker/signInProviders.ts](../worker/signInProviders.ts),
  [worker/signInCallback.ts](../worker/signInCallback.ts)): the page leaves for the provider by a full-page
  redirect with a nonce bound to the device's key. Google returns to `/api/auth/google/callback`
  (`@codefusion-cc/google-sign-in`); Microsoft, Apple and OpenID Connect post back to
  `/api/auth/<provider>/callback`, which hands the token to the page in the fragment. The page enrolls the
  device with the token; the Worker verifies it, derives the **account ID** (provider and subject), the
  **internal ID** (keyed) and the **member ID** (a keyed hash of the verified email), and issues a session. The
  token and the email are not kept server-side.
- **The account gateway** ([worker/gateway.ts](../worker/gateway.ts), a `UserGateway` Durable Object per
  account) keeps the account's sessions and devices, linked devices (`accountDevicesGateway`), its plan
  (`membershipGateway`, which keeps the **AccountDirectory** current), call budgets (`mediaGateway`) and the
  `workspace.authorize` command.
- **Linked devices** ([src/account](../src/account)): the first device makes the account's keys; another one is
  linked by comparing a six-digit code on both screens (`useLinkedDevices`). The account key signs what only
  the account may change: the member lists of the workspaces it owns.

## Workspaces

- **A workspace** ([src/workspaces/workspaces.ts](../src/workspaces/workspaces.ts)) is a secret made on its
  owner's device, a name and an owner-signed **member list** ([shared/memberList.ts](../shared/memberList.ts)):
  emails, a revision and the owner's account key signature, scoped to a capability derived from the secret. The
  invite link carries all of it in its fragment (`/join#invite=…`).
- **Entering** ([worker/workspaces.ts](../worker/workspaces.ts)): the device sends the list to its gateway
  (`workspace.authorize`). The gateway verifies the signature against the owner's account key, refuses a list
  older than the channel's, derives each member ID, and authorizes the workspace's **channel** (named by a route
  ID derived from the capability with the server's secret) to admit exactly those member IDs. It also says
  whether the channel keeps history: only the owner's session decides that, by the owner's plan.
- **The channel** ([worker/channel.ts](../worker/channel.ts), `defineAuthorizedChannel`) admits the listed
  members' sessions, says who is connected, and relays encrypted events: `p2p` (WebRTC signals), `chat`,
  `channel`, `workspace`, `roster`, `profile` and `typing`. With history on it keeps `chat` events (the latest
  5,000) and the latest `channel`, `workspace` and `roster` state; when history ends it deletes them.

## Content

- **Ops** ([src/content/ops.ts](../src/content/ops.ts)): every change is an immutable op (`msg`, `edit`, `del`,
  `react`, `chan`, `ws`) signed by its author's device. [src/content/derive.ts](../src/content/derive.ts) turns
  ops into channels, messages, edits, deletions and reactions the same way on every device, whatever order they
  arrived in; only an author's own edits and deletions count, and only the owner's workspace name.
- **Trust**: an op counts once the server has vouched that its device is its author's (the channel names each
  event's sender; a direct link is to a connection the channel named). Until then it waits, unseen
  ([src/content/opStore.ts](../src/content/opStore.ts)).
- **Delivery** ([src/workspaces/session.ts](../src/workspaces/session.ts)): with history on, ops go through the
  channel; without it, over the data mesh (`@codefusion-cc/realtime-p2p`) to every member online.
- **Catching up** ([src/content/sync.ts](../src/content/sync.ts)): two devices that meet compare digests of their
  ops per day and push what the other lacks, including other members' ops, so content spreads while anyone who
  has it is online.
- **Storage**: one IndexedDB database per account on the device ([src/content/db.ts](../src/content/db.ts)).

## Premium

What it adds and how staff grant it: [PREMIUM.md](PREMIUM.md).

## The page

- [src/App.tsx](../src/App.tsx) routes signed out (sign-in, legal) and lazy-loads the signed-in
  [Shell](../src/shell/Shell.tsx): the workspace rail, home, a workspace with its channels and members, joining,
  settings. [src/router.ts](../src/router.ts) maps paths to routes.
- Every string is in [src/i18n.ts](../src/i18n.ts) (English and Polish); colours, sizes and spacing are theme
  tokens in [src/index.css](../src/index.css), each colour at 4.6:1 or more with its text.
- [public/sw.js](../public/sw.js) keeps the app shell for offline use; `@codefusion-cc/app-update` moves open tabs
  to a new deploy when nothing would be interrupted.
