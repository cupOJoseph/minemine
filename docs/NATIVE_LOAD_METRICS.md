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

The native workflow temporarily copies its config with `max_users = 4` for the disposable test world; the checked-in two-player alpha config is unchanged. After the two-wallet protection test, `test/integration/browser-native-load.mjs` signs in four distinct disposable wallets and keeps their real browser engines connected, first at two and then at four. It requires two fresh native snapshots at each stage and saves them with the server/Node memory series in the workflow artifact. The browser processes run outside the 1 GiB server/Node service limit.

[Native run 41579632572](https://github.com/cupOJoseph/minemine/actions/runs/41579632572) passed all jobs. Its retained snapshots reported two, two, four and four online players. The four-player windows had 91.35 and 91.14 ms p95 step intervals. The Luanti/Node service cgroup peaked at 265,560,064 bytes with zero OOM kills. Individual browser join times were 10.1, 18.2, 48.7 and 68.9 seconds; the later joins are a concern even though the short server-step windows stayed near 90 ms. This one CI runner and already-edited test world do not prove a four-player public capacity or a 16-player scale result. Browser resource use, sustained edits, remote latency and reconnect behavior at four players were not measured.

The native log records 2, 8, 30 and 40 seconds between the four clients' new-connection and joined-game lines, respectively. The first two timings are also affected by one-second log precision. The browsers share the same CI runner CPU even though they sit outside the server memory cgroup. The timing rehearsal records wallet challenge/verify, document load, ticket response, game-proxy opening and native connection-to-join separately in `native-load-joins.jsonl`; these timings locate the slow phase without guessing at a server setting. A separate-client-host run is still required to remove CI browser CPU contention from the server capacity measurement.

[Timing run 41581463747](https://github.com/cupOJoseph/minemine/actions/runs/41581463747) passed and retained the new join-phase file. Ticket responses arrived 4.2, 5.9, 11.7 and 7.3 seconds after each client's page navigation, while Luanti connection-to-join took 2, 17, 82 and 90 seconds. Total join times were 8.1, 30.1, 125.8 and 158.1 seconds. Its two four-player snapshots again had about 91 ms p95 step intervals, and the 1 GiB server/Node cgroup peaked at 250,056,704 bytes with zero OOM kills. This isolates a large delay after the browser opens its game proxy, including the native connection-to-join phase; it does not prove whether the cause is client CPU contention, transport reliability, map delivery or another handshake cost. Test with clients on separate hardware and collect per-process CPU and network traces before changing world limits.

[Separate-process run 41673320789](https://github.com/cupOJoseph/minemine/actions/runs/41673320789) launched each disposable client in its own Chromium process with the same four-player world, timing fields and server memory limit. All jobs passed. Total joins took 8.1, 10.1, 12.1 and 16.2 seconds; native connection-to-join took 2, 3, 3 and 5 seconds. Two four-player snapshots had 91.11 and 91.17 ms p95 step intervals. The 1 GiB server/Node cgroup peaked at 279,097,344 bytes with zero OOM kills. This is much faster than the four-context runs and makes shared-browser scheduling a plausible contributor. The runs used different CI runners and time windows, so the comparison does not establish causation. All clients still shared their CI runner's CPU; separate client hardware, sustained edits and sixteen-player load remain the capacity gate.

## First capacity rehearsal

On a named test host, record the exact Luanti build, world seed/size, view-distance settings, host plan, CPU and RAM limit, client hardware/browser, and network location. Keep clients outside the server's resource limit. Collect snapshots at idle and during a staged 2, 4, 8 and 16-client run, with joins, movement, block edits, town-protected edit denials and reconnects. Preserve a timestamped series of the snapshots, native log, service CPU/RAM, disk growth and network egress. Record successful joins, edit visibility, disconnects and reconnect time. A two-client short smoke test cannot be extrapolated to sixteen players.

The first $10/month host is sized only for the invite-only two-player alpha. Compare the measurements with client-visible delay and resource headroom before setting an acceptable player cap or changing the host budget. If server-step intervals or max lag rise sharply, a separate SpacetimeDB process cannot by itself make Luanti's world simulation faster; use the [scaling plan](SPACETIMEDB.md) to choose which state, if any, should move after the native baseline is known.
