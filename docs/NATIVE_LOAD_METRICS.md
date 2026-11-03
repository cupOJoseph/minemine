# Native world load measurements

This is instrumentation for the first shared MineMine world. It does **not** establish a player capacity or make the world public. The snapshot is written by the wallet-auth mod to `minemine-native-metrics.json` inside the private world directory roughly every ten seconds. `WORLD_DIR=/srv/minemine/world npm run metrics:native` checks its schema and freshness, then prints it. Keep the file outside the web root.

## What the numbers mean

| Field | Meaning |
| --- | --- |
| `online_players` | Luanti's count of connected player objects when the snapshot was written. |
| `samples`, `sample_seconds` | Server-step samples and their total elapsed time in this roughly ten-second window. |
| `step_interval_ms_mean`, `p50`, `p95`, `p99`, `max` | Elapsed milliseconds **between** globalstep callbacks, including scheduling and other work. A long interval can signal lag; it is not CPU execution time for one callback. |
| `server_max_lag_ms` | Luanti's built-in current maximum lag, when available. Its internal window is separate from the sampled percentiles. |
| `observed_at` | Unix timestamp in seconds. The checker rejects a file older than 30 seconds. |

[Luanti's API](https://api.luanti.org/core-namespace-reference/) defines `register_globalstep`'s `dtime` as time since the last server step and exposes `get_server_max_lag()` separately. Its [timing guide](https://docs.luanti.org/for-creators/api/timing-and-event-loop/) warns that expensive globalstep work can block the server thread. MineMine only collects one number per step and sorts/writes the small window periodically. The first production rehearsal must still measure whether that work has a material cost.

## Four-client CI rehearsal

The native workflow temporarily copies its config with `max_users = 4` for the disposable test world; the checked-in two-player alpha config is unchanged. After the two-wallet protection test, `test/integration/browser-native-load.mjs` signs in four distinct disposable wallets and keeps their real browser engines connected, first at two and then at four. It requires two fresh native snapshots at each stage and saves them with the server/Node memory series in the workflow artifact. The browser processes run outside the 1 GiB server/Node service limit. A green run proves four joins on that specific CI machine and world, not a four-player public capacity or a 16-player scale result. Browser resource use and per-edit latency are not yet measured by this rehearsal.

## First capacity rehearsal

On a named test host, record the exact Luanti build, world seed/size, view-distance settings, host plan, CPU and RAM limit, client hardware/browser, and network location. Keep clients outside the server's resource limit. Collect snapshots at idle and during a staged 2, 4, 8 and 16-client run, with joins, movement, block edits, town-protected edit denials and reconnects. Preserve a timestamped series of the snapshots, native log, service CPU/RAM, disk growth and network egress. Record successful joins, edit visibility, disconnects and reconnect time. A two-client short smoke test cannot be extrapolated to sixteen players.

The first $10/month host is sized only for the invite-only two-player alpha. Compare the measurements with client-visible delay and resource headroom before setting an acceptable player cap or changing the host budget. If server-step intervals or max lag rise sharply, a separate SpacetimeDB process cannot by itself make Luanti's world simulation faster; use the [scaling plan](SPACETIMEDB.md) to choose which state, if any, should move after the native baseline is known.
