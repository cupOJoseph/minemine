# Validation record

## Local Ethereum execution — 2026-10-18 UTC

`npm run test:evm` passes 8 tests (parent plus 7 subtests) with pinned @foundry-rs/anvil 1.7.1 and the existing Solidity 0.8.26 compiler. Anvil binds a temporary loopback port on chain 31337, uses disposable development accounts and is terminated after the test. There is no chain fork, external RPC, public deployment or use of a user wallet/key.

Executed behavior covers zero-treasury rejection, constructor supply/metadata/balances, transfers with supply preservation, overdraft and zero-address rejection, allowance consumption, unauthorized delegated transfers, direct/delegated burns with supply reduction, over-burning rejection and rejection of a mint selector. The test then signs in through the real HTTP auth service, reads the deployed contract through /api/currency/balance, checks exact raw/formatted balance and observation metadata, and verifies a mismatched configured chain returns HTTP 503. `npm run test:http` also passes after extracting the common HTTP test helper. These tests do not establish Sepolia deployment or in-game spending/rewards.

## Public hosting prerequisite check — 2026-10-18 UTC

GitHub Pages is configured only for cupOJoseph/minemine. The manual Pages workflow run 39147878181 succeeded and published a prerequisite check at https://cupojoseph.github.io/minemine/. In the real in-app Chromium browser (reported Chrome 155), the page showed PASS for HTTPS, cross-origin isolation, SharedArrayBuffer, WebAssembly JSPI, WebGL 2, OffscreenCanvas and Web Workers. The pinned isolation worker is scoped to /minemine/ and the initial navigation successfully reloaded under its headers. This is a browser/host check, not an engine playtest or a gameplay result.

Vercel's existing CLI access token was rejected, and its existing refresh credential returned invalid_grant. No new Vercel permissions, project or paid service were created. GitHub Pages is the user's other authorized host and avoids dependence on that expired login.

WASM run 39147600484 stopped promptly at libarchive's bundled config.sub, which does not recognize the emscripten OS name. The build now uses wasm32-unknown-none for that Autoconf cross-compilation check. The actual bundled config.sub was executed locally with that target and returned wasm32-unknown-none successfully. Emscripten remains the compiler; this changes the configure target label, not the compiler. A new Linux run is required to validate the full dependency build.

## GitHub access restored — 2026-10-18 UTC

Both source commits were pushed to the sole authorized repository, cupOJoseph/minemine. The first remote WASM run (39146391458) installed the Linux prerequisites and passed npm test, then failed before compilation because the downloader queried HEAD in a newly initialized checkout. The downloader now checks whether HEAD exists before reusing a pinned checkout.

Foundation CI exposed that Node's fetch replaced the integration test's Host header with its ephemeral TCP address. The test now uses node:http directly, checks rejection of an unexpected host, and completes challenge/signature/login over a real local TCP listener. npm run test:http passes locally (1 test). Production Host validation was retained.

The historical access failures below no longer describe current GitHub connectivity. Engine compilation and browser gameplay remain unverified.

The corrected remote build (39146557489) reached dependency compilation. It exposed libarchive's configure trying to execute a WASM test program and libzip attempting shared linking against non-PIC static zlib. The prepared source copy now explicitly sets libarchive's cross-compilation host and disables shared/tool/test builds for libzip. The parent build now runs bash with -e so dependency failures stop immediately. Dependency script hashes are recorded in the build profile and guarded against changes; diagnostic artifacts now include libarchive config.log and CMake YAML logs. These corrections pass JavaScript/source-contract tests but still need a successful Linux build. Prepared Emscripten SDKs are cached on the runner to reduce repeated downloads.

## Engine integration update — 2026-10-18 UTC

The three pinned source repositories are now present and their HEADs/remotes were checked. Local Git commits work in the nested minemine clone. The original root-folder Git-write restriction is no longer the relevant build blocker.

- `npm test`: 20 passed, 0 failed, 0 skipped with the downloaded source present. This includes loading the actual upstream launcher classes in an inert JavaScript context, checking their public API, and exercising ready/pack/failure/timeout behavior with an engine test double. It does not execute WASM.
- `npm run upstream:fetch`: verified all already-present pinned sources without making network requests.
- `node scripts/prepare-wasm.mjs`: prepared a separate source copy and verified guarded build-flag patching. Downloaded upstream sources remain untouched. Configured heap/worker reductions have not been compiled or benchmarked.
- `node scripts/pack-game.mjs`: built the actual pinned Minetest Game content pack, 2,349,977 compressed bytes. Archive inspection confirmed game.conf, game licensing, the starter mod, and local world metadata. No engine binary was built.
- Syntax checks passed for the new JavaScript modules and Bash build entrypoint. The HTTP handler suite exercises streaming and confirms the relaxed engine styling/menu CSP stays separate from wallet pages.
- The workflow was corrected to use Node 24 and install the inspected Linux prerequisites. It has not run remotely.

A narrow GitHub network escalation was attempted through the tool's supported approval mechanism. It was rejected because sandbox_approval/rules/request_permissions are disabled in the configured granular approval policy. The local environment still lacks Node 24, CMake, patched Emscripten, and Docker. No build, live-browser verification, or public deployment is claimed. The concrete next step is the prepared Linux Actions workflow described in PLAYTEST.md.

The record below describes earlier foundation validation and historical blockers.

Date: 2026-10-16. Host: macOS arm64, Node v22.16.0.

## Passed

- Dependency restoration from the existing npm cache, with package integrity validation.
- Clean `npm ci --offline --cache /tmp/miners-npm-cache --ignore-scripts --no-audit --no-fund`: 19 installed packages. That temporary cache is machine-local and not part of the source deliverable. On a normal connected machine, use `npm ci --ignore-scripts`.
- `npm test`: **13 tests passed, 0 failed, 0 skipped**.
- Actual ethers EOA signatures tested for correct recovery, address binding, challenge replay prevention, expiry, modified-message rejection, wrong-browser binding, logout, capacity limits and player identity mapping.
- HTTP **handler-level** tests for challenge/login/session/logout, response cookie flags, origin/host rejection, disabled game credentials, no configured balance, isolation headers, private-path rejection, oversized requests, content-type checks and rate limits.
- Grant tests for unpredictable passwords, two-minute expiry, hash-only persistence, rotation and session-specific revocation.
- `npm run contracts:compile`: Solidity 0.8.26; creation bytecode 3,510 bytes. ERC-20 ABI checked for transfer, approval, balance and burn operations; no public mint/admin/upgrade functions.
- JavaScript syntax checks for server and browser entry files.

## Attempted but blocked

| Operation | Observed result | Consequence |
| --- | --- | --- |
| `git ls-remote` / source fetch from GitHub | Could not resolve host | No upstream engine download or source pin resolution |
| `git init -b main` | `.git: Operation not permitted` | No initialized local Git repository |
| `gh auth status` | Invalid stored credential for cupOJoseph | No GitHub repository or remote CI run |
| `npm start` | `listen EPERM` on 127.0.0.1:3000 | No local preview server |
| Initial real-socket integration tests | `listen EPERM` even on ephemeral ports | Live HTTP remains unverified; retained separately as `npm run test:http` |
| Toolchain inspection | CMake, Docker, Emscripten absent | No native/WASM build |

The first test run passed nine checks and failed four real-socket checks due to the environment. The suite was then separated into socket-free handler tests and an explicit real-HTTP integration suite. The final 13-pass result does **not** imply the socket restriction was fixed.

Follow-up on 2026-10-16: the user supplied `https://github.com/cupOJoseph/minemine` as the sole authorized repository. An unauthenticated remote probe still failed with `Could not resolve host: github.com`, and `git init` still failed with `.git: Operation not permitted`. No supplied credential was used and no push was attempted. Documentation now requires repository-scoped authentication rather than a general GitHub login.

Subsequent follow-up: after explicit user instruction to use the provided credential, it was passed via hidden stdin into a temporary environment for `gh api repos/cupOJoseph/minemine`. The request failed with `error connecting to api.github.com`; no authentication outcome or repository state could be established. The credential was not saved to disk. Local project files were confirmed present at `/Users/cupo/Desktop/miner-game`; no push has succeeded.

## Not verified

- Browser rendering, responsive layout, wallet extension prompts or interaction behavior.
- WASM build, startup, OPFS persistence, frame rate, memory usage or cross-browser support.
- Lua execution, engine auth-handler semantics, legacy-hash/SRP handshake, privilege persistence, or live character reconnects.
- Proxy protocol compatibility, public multiplayer, uptime, backups or load capacity.
- Solidity execution in an EVM, constructor/transfer/burn behavior under runtime tests, token deployment or real RPC balance calls.
- Docker image build, remote CI, GitHub publication or hosting deployment.

The UI marks absent components as pending and disables gameplay. `gameReady` is a configuration/file-presence gate, not a server liveness probe. Do not treat this foundation as an audited or production-ready game/economy.
