# Premium

Free accounts get everything peer to peer: workspaces, channels and messages go between members' devices, and a
member who was away catches up from whoever is online. Premium is per account and pays for what needs the
server's resources:

| | Free | Premium |
|---|---|---|
| Messages between members online | ✓ | ✓ |
| Files between members online | ✓ | ✓ |
| History kept for the workspaces the account **owns** (latest 5,000 changes, encrypted) | | ✓ |
| Files kept in the cloud for those workspaces (sealed on the device, up to 5 GB each, R2) | | ✓ |
| Calls between members, peer to peer | ✓ | ✓ |
| Connections and calls relayed through Cloudflare TURN when a direct one fails | | ✓ |
| Calls of more than four people through Cloudflare Realtime's SFU | | ✓ |

- **History follows the owner's plan.** Only the owner's session sets a workspace channel's history, from the
  owner's plan and its end date; a member's plan does not change it. When the plan ends (its date passes or staff
  end it), the channel deletes everything it kept, files included, and members carry the content again.
- **Cloud files** ([worker/channel.ts](../worker/channel.ts), `cloudFiles` of `defineAuthorizedChannel`): the
  sender's device seals each file with a key from the workspace's secret and stores it under an id derived from
  the same secret (`/api/realtime/files/<route>/<id>`). Only a member connected to the workspace's channel may
  store or read one; the server never learns which file it is.
- **Relays follow the account's own plan** ([worker/ice.ts](../worker/ice.ts)): STUN for everyone, TURN
  credentials for a Premium account, renewed before they expire and rate limited.
- **A call follows its members' plans** ([worker/channel.ts](../worker/channel.ts), `channelCalls` of
  `@codefusion-cc/realtime-media`): free members call peer to peer without relays; when a Premium member is in it,
  the call may use TURN and, past four people, the SFU. Each account's SFU use is bounded by its gateway
  (`mediaGateway`).

## Granting it

Staff grant Premium in CodeFusion Console, Peerly → Accounts:

1. The person reads their **account ID** from Settings → Account (copy button) and sends it.
2. Search for it (the start is enough), open the account and choose **Grant premium**: a month, three months, a
   year or no end date, with an optional note. Several accounts can be granted at once from the list.
3. **End premium** takes it away now; it asks for a reason, kept in the console's audit log.

The account's open tabs change at once. The console reaches Peerly through its `PEERLY_ADMIN` service binding
and Peerly's `ConsoleAdmin` entrypoint ([worker/console](../worker/console)); accounts are listed by the
`AccountDirectory` Durable Object, which holds no email or name.

Payment is not built yet: the plan model (`membershipGateway({ plans })`) is what a checkout will set.
