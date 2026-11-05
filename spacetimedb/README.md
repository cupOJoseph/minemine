# MineMine SpacetimeDB profile pilot

This is a **server-written prototype**, not a live account directory and not a
replacement for Luanti's voxel, inventory, physics, or town authority. The
private `playerProfile` table holds an account address, stable native character
ID, display name and monotonic source revision. The public `playerDirectory`
table holds only the character ID, display name and revision. Any client can
read the public table; only a trusted bridge with a configured OIDC service
identity may write either table. The browser must never receive that credential
or the private account mapping. Both rows change in one reducer transaction.
The character ID is a deterministic hash-derived pseudonym from the wallet
address, so someone who already knows an address can compute its character ID;
the directory does not promise anonymity.

The schema requires `BRIDGE_ISSUER`, `BRIDGE_AUDIENCE`, and `BRIDGE_SUBJECT` as
database environment values. Use a service account whose token's `iss`, `aud`,
and `sub` match those exact values. The reducer verifies all three on **each**
call, including HTTP reducer calls that do not use a long-lived connection.
`spacetime.json` points only to a loopback development instance and contains
no credentials. A real environment needs its own target and OIDC service setup.

## Verify

Use Node.js 24.22.1 or newer in the 24 line and SpacetimeDB CLI **2.14.1**.
The npm package and CLI must match; older SpacetimeDB versions do not support
the typed environment declarations used here. From the repository root:

```sh
npm ci --prefix spacetimedb
npm run typecheck --prefix spacetimedb
npm test --prefix spacetimedb
spacetime build -p spacetimedb
npm run test:network:local --prefix spacetimedb
```

The unit tests use SpacetimeDB's in-memory datastore and test reducer
authorization, transaction rollback, replay, and revision ordering. Its test
harness does not verify JWT signatures, network connections, subscriptions,
durability, or real OIDC issuance. The loopback integration below covers
network delivery with disposable identities; real OIDC and durability remain
separate gates before this projection can serve players.

The network smoke starts a temporary loopback-only, in-memory standalone host,
publishes the module with disposable development-token claims, accepts one
authorized profile write and exact replay, rejects a second identity and an
anonymous writer without adding a public row, then writes a second row through
the server bridge path. The pinned host reports reducer denials with a non-200
status, which need not be 403. A non-owner identity reads the public directory
over SQL but cannot read the private wallet table. The test generates client
bindings with the pinned CLI, confirms that they omit the private table, and
uses the TypeScript SDK over WebSocket to subscribe to both public rows, receive
a live revision update, and create a new connection with the same token and
identity. CI downloads the official Linux 2.14.1 archive and verifies its
SHA-256 before running this check. The local development token is scoped to
that disposable host; a real OIDC bridge write, browser subscription,
automatic reconnect after an outage, and hosted durability remain untested.
If the `spacetime` command selects an older CLI, set `SPACETIME_CLI` to the
absolute path of the 2.14.1 `spacetimedb-cli` binary for the last command.

## Projection contract

- `accountId`: lowercase EVM address already bound to a signed MineMine session
  by the trusted web server, never taken directly from a browser reducer call
  or published in the player directory.
- `playerId`: the stable `w_` native character ID bound to that account by the
  private MineMine registry. The bridge reads it from `wallet_profiles`; a
  later revision cannot change the binding.
- `displayName`: the native character ID initially, or a normalized ENS name
  after the web server verifies current wallet ownership or a managed name's
  address record. The source queues a new revision when that verified display
  changes. The bridge checks it again before publishing; if verification fails,
  it publishes the stable ID at a newer revision. This table does not claim
  name ownership or enforce name uniqueness on its own.
- `revision`: a durable per-account integer assigned by the authoritative
  source. Exact retries are idempotent; older revisions cannot overwrite a
  newer projection; a different value at the same revision is rejected.

## Source bridge pilot

The MineMine name registry writes a durable profile projection row in the same
SQLite transaction as a verified wallet sign in. Opening an older registry
backfills existing wallet profiles. The bridge joins the pending row to the
private wallet profile to obtain its stable character ID and fails if that
binding is missing. The first revision uses the native character ID as its
display name. A verified identity read or ENS selection can queue a changed
display name. A bounded one-shot command reads pending rows, obtains a
SpacetimeAuth service token with `client_credentials`, rechecks any ENS display
through the configured mainnet `ENS_RPC_URL`, and sends
confirmed `upsert_profile` HTTP calls, and acknowledges each successful row.
Before sending pending rows, the same command rechecks up to ten acknowledged
ENS displays that have not been checked in two minutes, oldest first. A failed
ownership or resolver lookup queues a newer stable-ID revision; the command
then attempts to publish that fallback. The check timestamp is durable, and
an older registry gains the column on open. If the process stops after a remote commit but before the local acknowledgement,
the revision is retried safely. Failed rows remain pending. If an ENS check
fails, the bridge replaces that row with a higher-revision native ID before
sending; without a verifier it refuses to send the ENS value. The loopback
network smoke exercises this bridge path with a disposable development token.

After configuring a real database, module `BRIDGE_ISSUER`, `BRIDGE_AUDIENCE`,
and `BRIDGE_SUBJECT` must match the SpacetimeAuth service token's claims. Set
`SPACETIME_DB_ORIGIN`, `SPACETIME_DB_NAME`, `SPACETIME_AUTH_CLIENT_ID`, and
`SPACETIME_AUTH_CLIENT_SECRET` privately on the Node host. Set `ENS_RPC_URL` to
a mainnet endpoint for ENS display checks, then run
`npm run profiles:sync`. Keep the client secret out of the repository and
browser. The command sends at most 100 pending rows and rechecks at most ten
already-published names per invocation, requires HTTPS,
and exits on a failed write. `WORLD_DIR=/srv/minemine/world node
scripts/sync-spacetime-profiles.mjs --status` prints the pending row count
without needing a service credential. The host archive contains an optional
[oneshot service](../deploy/vps/minemine-profile-sync.service) and
[replay timer](../deploy/vps/minemine-profile-sync.timer). Install both units
only after the hosted database and real OIDC service credential pass one manual
sync; the timer is not enabled by the archive. Run the status command and a
manual `systemctl start minemine-profile-sync.service`, confirm the row count
falls, and inspect `journalctl -u minemine-profile-sync.service` before enabling
the timer. The service writes only to the private world directory and reads
the same private environment file as the web service. Its 20-minute deadline
covers the bounded 100-row batch; a failure leaves unacknowledged rows for the
next run. The [systemd timer reference](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)
defines `OnBootSec` and `OnUnitActiveSec` for first start and repeat runs.
The profile table is private; do not add a public view or table containing
wallet addresses.

An ENS name can transfer or expire while its owner is offline. The optional
timer can eventually replace a stale published name, but it is disabled by
default. The two-minute check interval is not an immediate revocation promise:
backlogs, RPC failures, service outages, and an unavailable database can delay
the public update. A failed check falls back to the stable ID, and a later
verified identity read can restore a valid ENS display. Real SpacetimeAuth token
issuance, a hosted database, live replay after restart, browser subscription,
automatic outage recovery, observed recheck lag and host budget measurement
remain untested. This bridge does not
increase the native Luanti world's player capacity. Keep the module off the
public client path until those gates pass.

Sources: [SpacetimeDB authentication](https://spacetimedb.com/docs/core-concepts/authentication/),
[auth claims](https://spacetimedb.com/docs/core-concepts/authentication/usage/),
[module environment](https://spacetimedb.com/docs/databases/environment-variables/),
[module tests](https://spacetimedb.com/docs/how-to/unit-testing/),
[TypeScript subscriptions](https://spacetimedb.com/docs/clients/typescript/),
[generated client bindings](https://spacetimedb.com/docs/clients/codegen/),
[Maincloud connection URL](https://spacetimedb.com/docs/how-to/deploy/maincloud/),
and [HTTP reducer calls](https://spacetimedb.com/docs/http/database/).
