# Production rollout

Production is one Cloudflare Worker (`peerly`, [`wrangler.jsonc`](../wrangler.jsonc))
serving the app, signaling through Durable Objects, and handing out Cloudflare
STUN and TURN. Moving production content to Durable Objects is in
[DURABLE_OBJECTS_CUTOVER.md](DURABLE_OBJECTS_CUTOVER.md).

## Secrets

`RENDEZVOUS_SECRET`, `NETWORK_SESSION_SECRET`, `OPAQUE_USER_ID_SECRET`,
`TURN_KEY_ID` and `TURN_KEY_API_TOKEN` are required; wrangler refuses to deploy
without them. The TURN key is provisioned and rotated through CodeFusion
Console, never set by hand. Never place secret values in git, JSONC or shell
history.

## Checks after a deploy

CI runs `pnpm run verify:production` after every production deploy: the site
must send HSTS, and `GET /api/media/health` must report that the Worker still
gets TURN credentials from Cloudflare. The same check runs from the Worker's
cron every five minutes and logs an error when it fails twice, three seconds
apart; the console turns that line into a failure. Run it against preview with
`PRODUCTION_SITE_URL=https://preview.peerly.cc pnpm run verify:production`.

## Independent review

Commission an independent test of forged OIDC/device attestations, replay and
cross-app/audience attacks, invitation interception, topic authorization,
reconnect and IP rate-limit bypass, TURN credential abuse, WebSocket parsing,
and backpressure. This repository supplies test tooling and controls; it
cannot substitute for independent production access and review.
