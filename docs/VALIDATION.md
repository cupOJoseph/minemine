# Validation record

## Native town protection with two wallet players — 2026-10-22 EDT

[Actions run 39783194281](https://github.com/cupOJoseph/minemine/actions/runs/39783194281) installed a CI-only probe mod in the disposable native world. It kept two signed-wallet Chromium characters connected, supplied a nine-column quota fixture for the owner, and invoked the real `/town` command and `core.is_protected` paths inside Luanti. The probe passed town creation, refusal of a 25-column claim, acceptance of the paid-size nine-column claim, owner access, outsider denial, invitation and member access, and denial after the owner removed that member. The probe is not part of the production game pack or deployed world.

The quota file was a controlled fixture. This run does not prove that an ERC-20 purchase reaches the town quota, that an actual dig/place packet is denied, or that claim state survives a restart. Those remain end-to-end gates alongside Sepolia deployment and a public host.

## Browser wallet joins native world with credential-safe engine — 2026-10-22 EDT

[Actions runs 39730813198](https://github.com/cupOJoseph/minemine/actions/runs/39730813198) and [39731357942](https://github.com/cupOJoseph/minemine/actions/runs/39731357942) ran headless Chromium with the pinned actual Luanti WASM engine against native Luanti 5.16.1. The test signed a wallet challenge over HTTP, installed its HttpOnly session in Chromium, requested a two-minute game ticket from the same-origin frame, connected through the authenticated WebSocket/UDP bridge, and observed the wallet character's `joins game` line in the native server log. This is a real one-client interoperability result, including the native password handshake, not a stubbed protocol test. The browser remained in Multiplayer mode and received the native welcome chat.

Both early runs failed the credential-safety gate because the pinned WASM engine printed its command-line arguments to the browser console; those arguments contained the short-lived game password. The pinned source contains this dump in `src/mainloop.cpp`. The build removes that exact loop in a prepared source copy before compilation. The fresh WASM artifact succeeded in [run 39732303223](https://github.com/cupOJoseph/minemine/actions/runs/39732303223), and [native/browser run 39733900157](https://github.com/cupOJoseph/minemine/actions/runs/39733900157) staged that artifact, observed the wallet character join native Luanti, and passed the browser console credential check. [Two-wallet native/browser run 39734550466](https://github.com/cupOJoseph/minemine/actions/runs/39734550466) then opened separate Chromium contexts with distinct signed wallets, observed both characters join the same running native world while the first browser stayed open, and passed both console credential checks. The integration test detects full console messages before shortening diagnostic output and writes only redacted ticket text to retained artifacts. Shared world edits, reconnect persistence, privilege rejection and public remote hosting have not yet been exercised.

## Native server build and startup — 2026-10-22 EDT

[Actions run 39725139279](https://github.com/cupOJoseph/minemine/actions/runs/39725139279) compiled the pinned official Luanti 5.16.1 server on Ubuntu 22.04, installed the pinned Minetest Game, and started a SQLite-backed world on `127.0.0.1:30000`. The captured info output confirms `wallet_auth` and `town_claims` both loaded without Lua errors. After clean shutdown, CI archived the world, restored it to a different directory, and started the restored world on the same private port. This proves build, mod loading, startup and a stopped-world restore on Linux. It does not prove player login, live browser compatibility, remote hosting, or an operational backup drill on the eventual host. The pinned browser fork advertises protocol 53 and the native server 52, with both sources declaring client/server minimum 37; overlapping ranges make a handshake plausible but do not prove it.

## Restricted browser transport and adapter — 2026-10-22 EDT

`npm test` passes 28 source/handler checks, including a packet-shape comparison against the pinned webshims encoder. `npm run test:http` passes two real-socket integration checks: one signs in with an EOA over HTTP; the other signs in, performs the pinned webshims `NEWADDR`/`BIND` WebSocket handshake, sends a binary UDP packet to a disposable loopback game socket, verifies the exact echoed envelope, confirms unauthenticated upgrades and a non-game destination are rejected, and verifies logout closes an active proxy link. `npm run adapter:install` verified the local WASM bundle against its asset hashes and installed the remote adapter files. These checks do not exercise the compiled browser engine against a native Luanti server.

After moving ethers from 6.16.0 to 6.17.0 and using ws 8.22.0 for the bridge, `npm audit --omit=dev --json` reports zero production advisories. The unit/handler checks, two real-socket checks, nine local-EVM checks and both contract compilations passed after the update.

The adapter now waits for engine and game-pack readiness before requesting a two-minute wallet game ticket. The pinned launcher replaces its document body, so the adapter places it in a same-origin frame. Its in-frame ticket request and memory-only `LuantiArgs` path still need live wallet, browser storage/log, native handshake and logout-disconnect QA. `GAME_ENABLED` and `ENGINE_ADAPTER_READY` remain false.

Pages dispatch [39723016671](https://github.com/cupOJoseph/minemine/actions/runs/39723016671) from the feature branch failed before steps ran. The `github-pages` environment has a `main`-only deployment branch rule. The earlier published solo page remains at the public root; landing publication must follow PR review/merge and a main-branch workflow run.

## MineMine landing, ENS, transfers and towns — 2026-10-22 EDT

The feature branch passed `npm test` (26 tests), `npm run test:http` (one real TCP integration test), `npm run test:evm` (one parent with eight EVM subtests), and `npm run contracts:compile` for both MineToken and TownBlocks. The local EVM suite deployed both contracts on disposable Anvil chain 31337. It verified token transfers and burns, exact town payment and per-wallet purchased counts, and authenticated Node reads plus private quota-file sync. No public wallet, testnet key, gas, or live chain was used.

The MineMine landing page was visually inspected in the in-app Chromium browser from the local Node service. Its prominent Play Now link resolved to the staged local engine. The hash-verified Pages package was prepared in a separate temporary directory: landing files at its root, game at `/play/`, and gameplay screenshots under `/screenshots/`. Served under a subpath, its Play Now link navigated to `/play/`, the browser passed its engine checks, and the actual solo Luanti world rendered. The new wrapper displayed MineMine; the old compiled content pack still displayed “Miners playtest” in its initial in-game chat message, so the next WASM build must include the updated starter mod for full name consistency.

ENS reverse/forward checks and recipient normalization were verified with mocked mainnet RPC behavior; no live ENS RPC was configured. Wallet-extension signing, ERC-20 sending, approval/purchase prompts, native Lua auth and town protection, public multiplayer, and Sepolia finality/reorg behavior remain unverified. The online native world still needs a host, restricted WSS/UDP bridge, engine adapter, backup/restore and two-player smoke test. The current public Pages URL continues to show the previous solo page until this branch is published.

## Startup crash fixed and solo gameplay verified — 2026-10-18 UTC

The public build reached Creating server, then exited with code 1. The original launcher's unconditional reload concealed the engine error. Captured output showed `Access denied. Reason: Player name not allowed` after the reserved name singleplayer connected to a local multiplayer server. The pinned browser engine's clientlauncher.cpp selects GM_HOST_AND_JOIN when a world and a nonempty name are supplied. The adapter now omits the name argument, allowing GM_SINGLEPLAYER to set the reserved name internally. Failures retain their last 100 log lines; successful exits return to the launcher. Pages publishes current launcher files independently of the compiled engine artifact, with versioned module URLs to avoid stale launcher code.

Pages run [39150499921](https://github.com/cupOJoseph/minemine/actions/runs/39150499921) published the corrected launcher (8faa652) with the unchanged engine artifact from run 39147984307, release 96f0d5d5fc25. In the real in-app Chromium browser on the macOS arm64 host, the public page reached a controllable forest world and reported Singleplayer mode. Verified WASD movement and mouse look, opened inventory containing a steel pickaxe plus dirt/wood/torches, dug two blocks and placed a wood block. Engine output confirmed digging at (-192,9,200) and (-192,8,200), then placing default:wood at (-192,8,200). Exit to Menu completed with exit code 0. After reloading and starting again, the same hole, wood block, player position and view were present. Browser storage was OPFS. No external proxy was configured or needed for this solo smoke test.

Pages run [39150725773](https://github.com/cupOJoseph/minemine/actions/runs/39150725773) then published launcher revision 3cf4b8a. Launcher-only padding/button/progress styles are now scoped away from the runtime, fixing a clipped hotbar/inventory. Repeated startup at the unqualified public root URL succeeded; the full hotbar and inventory were visible, the wood marker remained, and inventory retained 98 wood and the 2 dug dirt blocks. Exit to Menu returned automatically to the launcher after shutdown.

The seven playtest adapter/build-contract tests pass, including the real pinned LuantiArgs serialization without --name. Displayed debug FPS samples were approximately 45–51; these are isolated observations, not a benchmark. Cold/warm startup measurements, peak memory, extended stability, storage-lock contention, other browser coverage, multiplayer and wallet/token gameplay remain unverified. The compiler artifact's browserVerified flag is a build-time field and remains false; this separate record identifies the launcher revision actually tested.

## Successful WASM build and public deployment — 2026-10-18 UTC

Actions run [39147984307](https://github.com/cupOJoseph/minemine/actions/runs/39147984307) succeeded, including the real dependency/engine compilation, game packaging and artifact upload. The compiler log identifies Emscripten 6.0.8 (aeb67926e7de656da38bc807d83050af93578758) and clang 24.0.0git. Full log: runtime/wasm-build-39147984307.log, plus GitHub's retained run log. The downloaded artifact is installed in ignored public/engine; every recorded local asset size and SHA-256 matched its build manifest.

Pages run [39149469057](https://github.com/cupOJoseph/minemine/actions/runs/39149469057) successfully published release 96f0d5d5fc25 at https://cupojoseph.github.io/minemine/. The published build.json reports solo-engine-playtest. Public index.html, lockworker.js and luanti.wasm returned successfully; the public WASM SHA-256 matches the built artifact. WASM size: 13,926,500 bytes. Recorded asset total: 21,300,742 bytes before HTTP compression. Configured initial heap: 512 MiB; worker pool: 8. These are artifact/configuration facts, not startup, FPS or peak-memory measurements.

Immediately after publication, both terminal and browser tool transports disconnected. Terminal access recovered and allowed public asset verification. Browser navigation and its session reset returned Transport closed. No real engine first frame, movement, mining, placement, inventory, quit/reload or persistence result is claimed. browserVerified remains false. The earlier seven-pass compatibility page checks are still the only real-browser runtime results. Reconnect browser control to resume QA against the deployed URL; no further repository or hosting permissions are needed.

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
