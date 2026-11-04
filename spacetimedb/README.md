# MineMine SpacetimeDB profile pilot

This is a **server-only prototype**, not a live account directory and not a
replacement for Luanti's voxel, inventory, physics, or town authority. The
`playerProfile` projection holds an account address, public display name, and
monotonic source revision. Only a trusted bridge with a configured OIDC service
identity may connect or write. The browser must never receive that credential.

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
durability, or real OIDC issuance. Those require a running server integration
test before this projection can serve players.

The network smoke starts a temporary loopback-only, in-memory standalone host,
publishes the module with disposable development-token claims, accepts one
authorized profile write and exact replay, rejects a second identity and an
anonymous caller with **403**, then writes a second row through the server bridge
path and reads both rows over SQL before stopping the host. CI
downloads the official Linux 2.14.1 archive and verifies its SHA-256 before
running this check. The local development token is scoped to that disposable
host; a real OIDC bridge write and subscription are still untested.
If the `spacetime` command selects an older CLI, set `SPACETIME_CLI` to the
absolute path of the 2.14.1 `spacetimedb-cli` binary for the last command.

## Projection contract

- `accountId`: lowercase EVM address already bound to a signed MineMine session
  by the trusted web server, never taken directly from a browser reducer call.
- `displayName`: the already validated MineMine or ENS display name. This table
  does not claim name ownership or enforce name uniqueness.
- `revision`: a durable per-account integer assigned by the authoritative
  source. Exact retries are idempotent; older revisions cannot overwrite a
  newer projection; a different value at the same revision is rejected.

## Source bridge pilot

The MineMine name registry writes a durable profile projection row in the same
SQLite transaction as a verified wallet sign in. Opening an older registry
backfills existing wallet profiles. The first revision contains only the stable
native character ID as `displayName`; this does not project ENS or managed
names without fresh ownership checks. A bounded one-shot command reads pending
rows, obtains a SpacetimeAuth service token with `client_credentials`, sends
confirmed `upsert_profile` HTTP calls, and acknowledges each successful row.
If the process stops after a remote commit but before the local acknowledgement,
the revision is retried safely. Failed rows remain pending. The loopback
network smoke exercises this bridge path with a disposable development token.

After configuring a real database, module `BRIDGE_ISSUER`, `BRIDGE_AUDIENCE`,
and `BRIDGE_SUBJECT` must match the SpacetimeAuth service token's claims. Set
`SPACETIME_DB_ORIGIN`, `SPACETIME_DB_NAME`, `SPACETIME_AUTH_CLIENT_ID`, and
`SPACETIME_AUTH_CLIENT_SECRET` privately on the Node host, then run
`npm run profiles:sync`. Keep the client secret out of the repository and
browser. The command sends at most 100 rows per invocation, requires HTTPS,
and exits on a failed write; schedule and monitor repeated invocations only
after the real credential and database have been tested. The profile table is
public in the pilot, so do not deploy it with real accounts before deciding
whether exposing account addresses is acceptable.

Real SpacetimeAuth token issuance, a hosted database, live replay after restart,
subscription/reconnect behavior, ENS display updates, and host budget
measurement remain untested. This bridge does not increase the native Luanti
world's player capacity. Keep the module off the public client path until those
gates pass.

Sources: [SpacetimeDB authentication](https://spacetimedb.com/docs/core-concepts/authentication/),
[auth claims](https://spacetimedb.com/docs/core-concepts/authentication/usage/),
[module environment](https://spacetimedb.com/docs/databases/environment-variables/),
[module tests](https://spacetimedb.com/docs/how-to/unit-testing/),
[Maincloud connection URL](https://spacetimedb.com/docs/how-to/deploy/maincloud/),
and [HTTP reducer calls](https://spacetimedb.com/docs/http/database/).
