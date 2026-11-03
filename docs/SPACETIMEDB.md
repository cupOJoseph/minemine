# SpacetimeDB scaling plan

This is the **next phase**, not part of the currently playable game. The present Luanti server remains authoritative for voxel edits, inventory, physics, and town protection. Adding a database by itself will not raise the engine's player limit; first measure native-server tick time, map emerge time, outbound bandwidth, reconnects, and memory with 16, then 32 and 64 clients.

## A safe first integration

1. Keep the existing SIWE wallet proof at the web edge. For SpacetimeDB 2.x, issue a short-lived OIDC token from a trusted issuer with a stable wallet-derived subject, proper audience and expiry. The module should authorize reducers from its validated caller identity; the browser must not be able to assert another wallet address in reducer arguments. The existing Node in-memory session token is not an OIDC token and should not be passed to SpacetimeDB as if it were one.
2. Move a bounded social-data slice first: player public profile, town name/membership, or presence. Keep Luanti's world and inventory as the source of truth. Define one writer per field and a migration/backfill process; avoid an uncontrolled dual-write period.
3. Add idempotent server-to-DB events for authoritative game changes. A Luanti mod or trusted bridge signs/authorizes these events; browser clients can subscribe to updates but cannot submit fabricated mining or block-edit events.
4. Model town claims as spatial records with owner, members, bounds, and revision. The payment entitlement still comes from confirmed on-chain reads. Reducers enforce ownership and non-overlap atomically. Only after the DB path passes the same protection and recovery tests should Luanti read decisions from it.
5. Load-test with real browser clients and bot traffic. Measure p50/p95/p99 reducer latency, tick time, broadcast volume, subscription filtering, reconnect catch-up, and server cost. Decide whether a single world needs world partitioning, engine changes, or a different simulation architecture based on these measurements.

SpacetimeDB's current documentation describes [OIDC authentication and reducer caller identity](https://spacetimedb.com/docs/core-concepts/authentication/) and warns that development server-issued tokens are not a production account-recovery plan in its [FAQ](https://spacetimedb.com/docs/intro/faq/). Its module model uses [tables, reducers, and subscriptions](https://spacetimedb.com/docs/intro/key-architecture/). Version the integration against the actual release selected for implementation; APIs and authentication behavior have changed across major versions.

## Acceptance gate for a single large world

A design is ready to replace a portion of Luanti authority only after two independent clients observe identical edits after reconnect, conflicting edits resolve deterministically, protection is enforced server-side, backups restore consistent world and account state, and a specified concurrency target holds acceptable tick and network latency on a named host. Until then, “many players in one world” remains a measured target, not a shipped feature.
