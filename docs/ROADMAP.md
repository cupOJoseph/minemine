# Roadmap and task tracker

Updated: 2026-10-22 UTC. `DONE` means the stated acceptance criteria have been checked. `IMPLEMENTED` means code exists but its necessary integration gate has not passed. Blocked tasks are not complete.

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
| B04 | CORE PASSED | Actual release 96f0d5d5fc25 is published on Pages. Startup crash fixed; movement, mouse look, starter inventory, digging, placement, clean exit and saved-world reload passed in Chromium. Extended stability, storage-lock and cross-browser QA remain. | B02 |
| B05 | IMPLEMENTED | A same-origin frame isolates the pinned launcher's full-body takeover. After engine/pack readiness it requests a fresh wallet ticket in the frame and passes credentials through `LuantiArgs` memory, not the URL or browser storage. Source-contract tests pass; native handshake, browser wallet and storage/log QA remain. | B04, A04 |
| B06 | TODO | Capture initial download size, decompression/compile time, peak memory, FPS/frame-time percentiles, and first controllable frame on specified hardware. | B04 |
| B07 | TODO | Tune viewing range, textures, shaders, chunk queues, caching, and compression based on B06. Regression benchmarks must improve measured bottlenecks. | B06 |

The first solo playtest works: `playtest/session.mjs` uses the inspected upstream API; `scripts/pack-game.mjs` exports the pinned game plus starter inventory/world metadata; staging records binary hashes and build provenance. Linux Actions uses Node 24 and the inspected toolchain. Initial heap/worker configuration is reduced in a separate build copy; performance benchmarking remains pending. See [PLAYTEST.md](PLAYTEST.md) and [VALIDATION.md](VALIDATION.md) for build/startup corrections and verified public gameplay.

Start with Minetest Game for low complexity. Evaluate Mineclonia/VoxeLibre only after the same engine, network, and auth smoke tests pass with a small game. Record game licensing, load sizes, and content downloads separately from engine performance.

**Provisional performance targets, not measured claims:** at least 30 FPS on a named low-end reference laptop at 720p, 60 FPS on a named mainstream reference laptop at 1080p, under 20 seconds cold start on a defined 25 Mbps connection, under 5 seconds warm start, and under 512 MiB peak client memory for the small reference world. Establish realistic thresholds after B06; do not optimize against an unspecified device.

## Milestone 2 — Persistent online multiplayer

| ID | Status | Task and acceptance criteria | Depends on |
| --- | --- | --- | --- |
| S01 | BLOCKED | Select Linux host/account, region, domain, and budget. Provision a dedicated service user, disk, TLS, and firewall. No provider or spending account supplied. | Hosting decision/access |
| S02 | TODO | Build native engine from reviewed source; create persistent world; confirm compatibility with the pinned WASM client. Verify backup restore. | B01, S01 |
| S03 | IMPLEMENTED | Same-origin `NEWADDR`/`BIND` bridge speaks the pinned webshims 24-byte UDP envelope, requires a live wallet session, and forwards only to configured loopback Luanti UDP port. Real WebSocket/UDP integration rejects unauthenticated upgrades and other destinations. Browser-engine interoperability, traffic/load tests and native-server QA remain. | B01, S02 |
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
| A06 | IMPLEMENTED IN BRIDGE | Logout revokes matching grants and closes that browser session's WebSocket game links. Verify native player disconnect, session expiry, bans and reconnect denial in a live world. | A05 |
| A07 | TODO | Replace in-memory sessions/grants with durable single-use coordination if scaling beyond one Node process; add distributed rate limiting. | A05 |
| A08 | TODO | Add ERC-1271 smart-wallet validation and EIP-6963 provider selection, with chain-bound tests. | A05 |
| A09 | IMPLEMENTED | Optional Ethereum-mainnet ENS lookups resolve send recipients, display forward-verified reverse names, and place the name in short-lived game grants for a Luanti nametag. Mock-RPC and grant tests pass; live RPC and native-engine QA remain. | A01, mainnet ENS RPC |

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
| E09 | IMPLEMENTED | Browser wallet encodes exact ERC-20 transfers to a validated address or ENS recipient and asks the wallet to submit the transaction. ABI/amount tests pass; live wallet, Sepolia receipt and balance-refresh QA remain. | E03, A03, A09 |

## Milestone 4b — Wallet-funded protected towns

| ID | Status | Task and acceptance criteria | Depends on |
| --- | --- | --- | --- |
| T01 | DONE | `TownBlocks` compiles and local Anvil execution verifies exact MINE payment, immutable token/treasury/price, cumulative per-wallet credits, limits, failed transfers and unauthorized buying. | E02 |
| T02 | IMPLEMENTED | Authenticated Node sync reads cumulative credits from the configured contract at a confirmed block, checks chain/token, and writes an atomic private quota file. Local EVM HTTP integration passes; Sepolia RPC/reorg testing remains. | T01, E03 |
| T03 | IMPLEMENTED | Luanti mod creates towns, claims paid x/z columns, prevents overlaps, manages members, and gates standard dig/place protection through `core.is_protected`. Native-engine and other-mod QA remain. | T02, S02 |
| T04 | IMPLEMENTED | Wallet lab can approve exact MINE allowance, buy 1–4096 columns, view confirmed credits, and request private-world sync. Live injected-wallet and transaction-failure QA remain. | T01, E03, A03 |
| T05 | TODO | Two wallets buy, sync, claim, invite, build, reject unauthorized edits, reconnect and restore after server restart on a remote test world. | S04, A05, T02–T04 |

The one-time purchase protects x/z columns through all heights. Contract price and treasury are deployment-time choices, not settled economy design. See [town protocol](TOWNS.md) for commands, trust boundaries, and launch gates.

## Milestone 5 — MineMine landing and scale plan

| ID | Status | Task and acceptance criteria | Depends on |
| --- | --- | --- | --- |
| L01 | IMPLEMENTED | Responsive MineMine landing page has a large Play Now hero, feature detail, roadmap, and three clearly attributed real game images. Local visual QA passed; public Pages deployment remains. | B04 |
| L02 | IMPLEMENTED | Pages packaging places the landing at `/` and verified solo engine at `/play/`; local hash-verified staging passed. Publish and verify Play Now on the public URL. | L01, successful WASM artifact |
| D01 | RESEARCH | [SpacetimeDB plan](SPACETIMEDB.md) defines OIDC wallet identity binding, authoritative reducer boundaries, migration and load-test gates. Implementation follows native multiplayer measurement. | S05 |

## Resume order

1. Keep the working solo playtest available at https://cupojoseph.github.io/minemine/. Core gameplay and persisted edits passed; do not rebuild just to resume QA.
2. Finish storage-lock contention, extended stability and cross-browser checks. Preserve visible failure diagnostics.
3. Record startup/frame/memory measurements and resolve dependency/license release review.
4. Publish the landing through the Pages workflow after PR review/merge; verify `/play/` and browser isolation. The Pages `github-pages` environment currently permits only `main`; a feature-branch dispatch on 2026-10-22 failed before steps ran. The existing public root still serves the old solo page.
5. Agree a persistent Linux host, region, domain and budget; then reach native multiplayer, restricted proxy and wallet-gated multiplayer. Do not enable the shared-world button from configuration alone.
6. Local EVM token and town purchases pass. Arrange isolated Sepolia deployment and live wallet QA, then verify native town protection end to end. Keep incomplete functionality disabled.
7. Measure the first shared world before beginning the SpacetimeDB migration.

Milestone boundaries track completed behavior rather than calendar guesses. The first build and multiplayer compatibility spike should determine the engine schedule.
