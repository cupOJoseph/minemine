# Roadmap and task tracker

Updated: 2026-10-18 UTC. `DONE` means the stated acceptance criteria have been checked. `IMPLEMENTED` means code exists but its necessary integration gate has not passed. Blocked tasks are not complete.

## Milestone 0 — Reproducible project foundation

| ID | Status | Task and acceptance criteria | Depends on |
| --- | --- | --- | --- |
| F01 | DONE | Research an existing Luanti WASM port and identify UDP/browser transport and isolation-header requirements. Findings linked in ARCHITECTURE.md. | — |
| F02 | DONE | Establish Node package, exact dependency lock, launcher source, tests, and token compilation. Offline clean install succeeds. | — |
| F03 | DONE | The sole authorized repository is pushed and main tracks origin/main. GitHub Actions runs have started successfully. | — |
| F04 | DONE | Foundation CI passes the signature/handler tests, real HTTP wallet-login test and Solidity compiler on a clean Linux runner. | F03 |
| F05 | DONE | Record bespoke tasks with dependencies, explicit acceptance criteria, and resume instructions. | F01 |

## Milestone 1 — Actual Luanti in a browser

| ID | Status | Task and acceptance criteria | Depends on |
| --- | --- | --- | --- |
| B01 | DONE | Browser wrapper, official engine, and Minetest Game are locally downloaded with matching remotes and pinned HEADs. Nested source pins and major license files have been inspected. Complete binary license notices remain a release gate. | — |
| B02 | DONE | Linux Actions run 39147984307 produced the real engine/game bundle, build profile, checksums and initial license notices. Emscripten 6.0.8 compiler identity and the full build log are retained. Complete dependency/license release review remains B03. | B01 |
| B03 | TODO | Review bundled OpenSSL/curl/libarchive versions; update or explicitly justify each exposed dependency. Rebuild with compatible patches and run dependency scanning. | B01 |
| B04 | IN PROGRESS | Actual engine release 96f0d5d5fc25 is published on Pages; public WASM hash matches. Prerequisite checks passed in Chromium. Browser control disconnected before world creation/walking/digging/placing/save tests; reconnect it to finish QA. | B02 |
| B05 | TODO | Add a version-specific same-origin adapter implementing `launch({container, ticket})`. Inspect upstream `setConf`/launch API and credential handling. No passwords in URLs, IndexedDB, localStorage, console, or analytics. | B04 |
| B06 | TODO | Capture initial download size, decompression/compile time, peak memory, FPS/frame-time percentiles, and first controllable frame on specified hardware. | B04 |
| B07 | TODO | Tune viewing range, textures, shaders, chunk queues, caching, and compression based on B06. Regression benchmarks must improve measured bottlenecks. | B06 |

The first solo playtest path is implemented: `playtest/session.mjs` uses the inspected upstream API; `scripts/pack-game.mjs` exports the pinned game plus starter inventory/world metadata; staging records binary hashes and build provenance. Linux Actions uses Node 24 and the inspected toolchain. Initial heap/worker configuration is reduced in a separate build copy; performance is unmeasured. GitHub connectivity and public Pages hosting now work. See [PLAYTEST.md](PLAYTEST.md) and [VALIDATION.md](VALIDATION.md) for build failures, corrections and the verified public prerequisite check. The public page is not yet gameplay.

Start with Minetest Game for low complexity. Evaluate Mineclonia/VoxeLibre only after the same engine, network, and auth smoke tests pass with a small game. Record game licensing, load sizes, and content downloads separately from engine performance.

**Provisional performance targets, not measured claims:** at least 30 FPS on a named low-end reference laptop at 720p, 60 FPS on a named mainstream reference laptop at 1080p, under 20 seconds cold start on a defined 25 Mbps connection, under 5 seconds warm start, and under 512 MiB peak client memory for the small reference world. Establish realistic thresholds after B06; do not optimize against an unspecified device.

## Milestone 2 — Persistent online multiplayer

| ID | Status | Task and acceptance criteria | Depends on |
| --- | --- | --- | --- |
| S01 | BLOCKED | Select Linux host/account, region, domain, and budget. Provision a dedicated service user, disk, TLS, and firewall. No provider or spending account supplied. | Hosting decision/access |
| S02 | TODO | Build native engine from reviewed source; create persistent world; confirm compatibility with the pinned WASM client. Verify backup restore. | B01, S01 |
| S03 | TODO | Implement or adopt the matching webshims network proxy. Authenticate connections and restrict all destinations to the private game server. Verify it cannot act as a public relay or reach metadata/internal services. | B01, S02 |
| S04 | TODO | HTTPS/WSS deployment with same-origin proxy routing, binary delivery and COOP/COEP. Two remote browsers join the same world and see each other's edits. | B04, S03 |
| S05 | TODO | Load test 16 concurrent clients; record tick latency, CPU, RAM, egress and reconnect behavior. Add process restarts, monitoring and disk alerts. | S04 |
| S06 | TODO | Publish a playable URL and server information only after auth, backup, and multiplayer gates pass. Verify access from a network outside the host. | S04, S05, A05 |

## Milestone 3 — Ethereum wallet login

| ID | Status | Task and acceptance criteria | Depends on |
| --- | --- | --- | --- |
| A01 | DONE | Issue server-generated SIWE messages with origin, URI, chain, random nonce and expiry; verify actual EOA signatures. Replay, wrong signer, changed domain, missing browser binding and expiry tests pass. | F02 |
| A02 | DONE | HttpOnly SameSite sessions, same-origin POST checks, request-size limits, bounded session/challenge stores, and rate limiting verified at handler level. | A01 |
| A03 | IMPLEMENTED | Browser-wallet UI connects, requests a signature, restores sessions, switches testnet and signs out on account/chain changes. Real HTTP signing/login passes; wallet-extension interaction still needs browser QA. | A01, browser QA |
| A04 | IMPLEMENTED | Issue random two-minute Luanti credentials and read grants through a wallet-only auth mod. JS grant tests pass. Native legacy-hash/SRP compatibility, registration rejection and privilege behavior are unverified. | S02 |
| A05 | TODO | End-to-end: two distinct wallets get different persistent characters; reconnect restores inventory; signature/ticket replay and expired grants are rejected; registration, password changes and privilege escalation fail. | B05, S04, A04 |
| A06 | TODO | Decide whether logout should disconnect live gameplay; add revocation and bans without allowing reconnect after logout. Current logout revokes outstanding matching grants but does not kick an already-connected player. | A05 |
| A07 | TODO | Replace in-memory sessions/grants with durable single-use coordination if scaling beyond one Node process; add distributed rate limiting. | A05 |
| A08 | TODO | Add ERC-1271 smart-wallet validation and EIP-6963 provider selection, with chain-bound tests. | A05 |

## Milestone 4 — ERC-20 in-game economy

| ID | Status | Task and acceptance criteria | Depends on |
| --- | --- | --- | --- |
| E01 | IMPLEMENTED | Fixed-supply MINE prototype compiles with OpenZeppelin. Naming, supply, allocation and chain are provisional. | F02 |
| E02 | DONE | Local Anvil execution verifies constructor/treasury/supply, zero-address rejection, transfers/allowances, direct/delegated burning, unauthorized spending rejection and rejection of a mint selector. | E01 |
| E03 | BLOCKED | Deploy to Sepolia using explicitly configured isolated test wallet and treasury; verify source and record chain/address/block. Script exists; no key, treasury or RPC supplied. | E02, testnet wallet/RPC |
| E04 | IMPLEMENTED | Authenticated balance endpoint is verified against a locally deployed contract, including exact integers/block/time and wrong-chain RPC rejection. Sepolia deployment/read validation remains pending. | E03 |
| E05 | TODO | Add Lua balance UI backed by authenticated server reads. Distinguish observed on-chain balances from spendable gameplay credit. | A05, E04 |
| E06 | TODO | Implement reward eligibility from authoritative game events, deduplicated event IDs and issuance limits. Never mint from client-reported mining. Decide treasury distribution vs future capped emissions. | A05, economic rules |
| E07 | TODO | Implement one real in-game purchase with chain confirmation, idempotent delivery, retries and reorg handling. No transaction per block mined. | E05, transaction/indexer design |
| E08 | TODO | Test abuse/recovery, treasury controls and end-to-end economy; obtain security review before any mainnet deployment or real-value launch. | E06, E07 |

## Resume order

1. Reconnect browser control; the engine is already compiled, downloaded and published. Do not rebuild just to resume QA.
2. Verify solo movement, digging, building, inventory, quit and saved reload at https://cupojoseph.github.io/minemine/; use console logs to diagnose real failures. Keep browserVerified false until those checks pass.
3. Record startup/frame/memory measurements and resolve dependency/license release review.
4. Reach native multiplayer and then wallet-gated multiplayer. Agree a persistent Linux hosting budget before provisioning additional infrastructure.
5. Execute local EVM tests, arrange an isolated testnet deployment and then integrate token spending/rewards. Keep incomplete functionality disabled.

Milestone boundaries track completed behavior rather than calendar guesses. The first build and multiplayer compatibility spike should determine the engine schedule.
