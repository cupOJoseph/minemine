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
anonymous caller with **403**, reads one row over SQL, then stops the host. CI
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

The next implementation step is a durable Node/Luanti bridge with an OIDC
service credential, a backfill, and a reconnect/replay integration test. The
bridge must read the canonical account/name registry and persist or derive
revisions across restarts. Keep this module off the public client path until
that test and a host budget measurement pass.

Sources: [SpacetimeDB authentication](https://spacetimedb.com/docs/core-concepts/authentication/),
[auth claims](https://spacetimedb.com/docs/core-concepts/authentication/usage/),
[module environment](https://spacetimedb.com/docs/databases/environment-variables/),
and [module tests](https://spacetimedb.com/docs/how-to/unit-testing/).
