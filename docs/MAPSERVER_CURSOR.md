# Mapserver v4.11.0 incremental cursor audit

Research checked 2026-11-03 against [tag v4.11.0](https://github.com/minetest-mapserver/mapserver/tree/v4.11.0). This is a finding about the existing live-map candidate, not a change to the public MineMine snapshot.

## Confirmed loss mode

The [SQLite trigger and query](https://github.com/minetest-mapserver/mapserver/blob/v4.11.0/db/sqlite/sql.go) set each changed block's `mtime` to `strftime('%s', 'now')`, then fetch `where mtime > ? order by mtime asc limit ?`. The [incremental job](https://github.com/minetest-mapserver/mapserver/blob/v4.11.0/tilerendererjob/incremental.go) persists the largest returned `mtime` as its next cursor. That timestamp has one-second resolution, so a limited batch can split rows with the same `mtime` and advance past the remainder. Re-editing a block within the cursor's second can also leave its `mtime` unchanged.

Run `python3 scripts/repro-mapserver-cursor.py` from the repository root. The in-memory SQLite reproduction copies the tagged legacy trigger/query rules and freezes one second for deterministic results: insert 200 distinct blocks, fetch with limit 128, persist the returned maximum `mtime`, then fetch again. The first query returns 128; the second returns **zero**, leaving **72 unseen rows**. Re-editing a block from the first batch within that second also returns zero on the next query. The tagged x/y/z query has the same timestamp predicate and limit. This proves an algorithmic loss mode under those conditions. It does **not** prove that this was the sole reason MineMine's earlier chosen tile stayed unchanged: tile selection, mapblock writes, layer filtering and renderer behavior were not isolated in that run.

Increasing `rendering_fetch_limit` cannot make the cursor correct for an arbitrarily large same-second burst or a same-second re-edit. A live-map fork would need a monotonic change sequence or another cursor that records every committed modification and paginates without dropping ties, followed by tests of map edits, restart, duplicate changes, and tile refresh on a copied world. It would also need a whole-VM CPU, RAM, disk and egress rehearsal under the owner's $10/month host ceiling.

## MineMine decision

Keep the [dated, bounded `/map/` snapshot](WEB_MAP.md) and its stopped-world backup exporter as the initial website map. Do not attach unpatched v4.11.0 to the public world or label its tiles live. The next host gate is a scheduled backup/refresh drill and outside-network map verification. Reconsider a live tile service only after its cursor is correct and the extra service fits the host budget.
