# Premium

Free accounts get everything peer to peer: workspaces, channels and messages go between members' devices, and a
member who was away catches up from whoever is online. Premium is per account and pays for what needs the
server's resources:

| | Free | Premium |
|---|---|---|
| Messages between members online | ✓ | ✓ |
| History kept for the workspaces the account **owns** (latest 5,000 changes, encrypted) | | ✓ |
| Connections relayed through Cloudflare TURN when a direct one fails | | ✓ |

- **History follows the owner's plan.** Only the owner's session sets a workspace channel's history, from the
  owner's plan and its end date; a member's plan does not change it. When the plan ends (its date passes or staff
  end it), the channel deletes everything it kept and members carry the content again.
- **Relays follow the account's own plan** ([worker/ice.ts](../worker/ice.ts)): STUN for everyone, TURN
  credentials for a Premium account, renewed before they expire and rate limited.

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
