# Validation record

## Shared 1 GiB service rehearsal — 2026-10-22 EDT

[Actions run 39855175363](https://github.com/cupOJoseph/minemine/actions/runs/39855175363) passed the two-wallet native/Chromium gameplay and clean restart workflow with Luanti and Node under one systemd slice configured with `MemoryMax=1G` and `MemorySwapMax=0`. The workflow checked the slice's cgroup files: `memory.max` was 1,073,741,824 bytes, `memory.swap.max` was zero, and both retained `memory.events` snapshots recorded zero OOM events and zero OOM kills. The slice's `memory.peak` reached 188,555,264 bytes (179.8 MiB) by the end of the first world session and was unchanged after restart. The slice can persist across service restarts, so the second snapshot is a cumulative high-water mark. One-second process samples separately peaked at 242.1 MiB combined Luanti + Node RSS over 148 first-session samples and 174.7 MiB over 19 restart samples. RSS and cgroup usage use different accounting and should not be treated as equal measures.

The retained markers report owner/outsider/member protection, denial after member removal, inventory and claim persistence through wallet reconnect, and inventory, a placed node, claim, and protection persistence after a clean Luanti/Node restart. The CI-only test also expired the owner's game ticket while that browser stayed connected; native `core.get_player_privs` still returned `interact`, and town access remained intact. This is a two-player **service** memory rehearsal on a larger GitHub runner. It does not fit Linux, Caddy, disk cache, deployment work, sustained public load, or more players into a 1 GiB VM. The public VPS remains unproven.

## Two-wallet server-process memory baseline — 2026-10-22 EDT

[Actions run 39844611581](https://github.com/cupOJoseph/minemine/actions/runs/39844611581) passed the pinned native/Chromium two-wallet workflow with one-second resident-memory sampling of the live Luanti and Node processes. The retained `server-memory-first.csv` contains 208 samples and a peak combined RSS of **208.1 MiB** (individual maxima: Luanti 107.3 MiB, Node 100.8 MiB). The 37 post-restart samples peaked at **165.7 MiB** combined. Town outsider, owner, invited-member and post-removal browser packet checks still passed, as did reconnect and full-stack restart.

This is a process baseline on a larger GitHub runner, not a 1 GiB capacity pass. It excludes the VM operating system, Caddy, filesystem cache, build/deploy work, long-lived world growth, and more players; one-second RSS sampling can miss short peaks and double-count shared pages. The proposed DigitalOcean host still needs a hard memory-limited rehearsal and an outside-network load check before provisioning is treated as viable.

## Invited member browser edits and removal — 2026-10-22 EDT

[Actions run 39839625595](https://github.com/cupOJoseph/minemine/actions/runs/39839625595) passed the pinned Luanti and two-wallet Chromium workflow. After the outsider's browser dig/place was denied and the owner's browser place/dig was allowed, the CI-only probe reinvited the second wallet to the same nine-column town. The browser client placed `default:wood` at `(1,20,0)` and dug it there; the native log and retained `town-packet-member-place-result.txt` and `town-packet-member-dig-result.txt` both report PASS. The probe then removed that wallet from the town. Its next browser placement reached Luanti at the same `(1,20,0)` target, logged a protected-position denial, and left the node air; `town-packet-removed-place-result.txt` reports PASS. The run also passed wallet reconnect and a clean Luanti/Node restart that retained inventory, the claim, and a separate owner-placed node.

The town quota was written as a controlled CI fixture. This run verifies browser packet authorization and revocation in a local native world; it does not verify a confirmed MINE purchase, a public host, overlapping claims, or interactions from other mods.

## In-game observed MINE balance — 2026-10-22 EDT

The local Anvil HTTP/EVM suite passed nine tests after a real MINE deployment. An authenticated `POST /api/currency/sync` read the connected wallet's balance at a fresh block, wrote a 0600 world snapshot with the matching wallet, token, chain, raw amount, formatted amount, block and 60-second expiry, and returned the observed value. An unauthenticated sync was rejected; a wrong-chain RPC wrote no snapshot. The 29 source tests also passed. [Actions run 39835786761](https://github.com/cupOJoseph/minemine/actions/runs/39835786761) passed the pinned native server and two-wallet Chromium smoke test. Its `town-probe-result.txt` says PASS; that CI-only probe calls `/wallet balance` in Luanti and asserts the missing, current and expired snapshot cases. The retained run also passed outsider browser dig/place denial, owner browser dig/place, wallet reconnect, and native/Node restart.

This shows a wallet balance in game as an observation only. The command cannot spend MINE or grant town credit. The native probe uses a synthetic snapshot to exercise display and expiry; no live Sepolia token, injected wallet transaction, or end-to-end chain-to-chat refresh has been verified.

## Owner browser dig and place survive full-stack restart — 2026-10-22 EDT

[Actions run 39831567107](https://github.com/cupOJoseph/minemine/actions/runs/39831567107) passed the current-head native workflow with two distinct SIWE-authenticated Chromium wallets in one claimed Luanti world. The retained markers report `PASS` for outsider browser dig denial, outsider browser place denial, owner browser placement, and owner browser digging at the same claimed target. The native log shows the owner placed `default:wood` at `(-63,5,-320)` and then dug it; the outsider's attempts left the target unchanged. Wallet reconnect and a clean Luanti/Node restart also passed, preserving the inventory stack, separate owner-placed backing node, nine-column claim, and owner/outsider protection.

The disposable browser fixture binds place to F and dig to G to keep headless pointer-lock movement from changing the camera during held clicks. The pinned WASM engine still sends ordinary native interaction packets, and production controls are unchanged. CI grants the town quota directly; it does not prove a confirmed ERC-20 purchase. Browser invited-member edits, live testnet payment delivery, remote-host recovery, and load capacity remain open.

## Owner browser placement succeeds in own town — 2026-10-22 EDT

[Actions run 39825871092](https://github.com/cupOJoseph/minemine/actions/runs/39825871092) passed the current-head native workflow. After an outsider's browser dig and place packets were denied at a nine-column claim, the disposable probe moved the owner to the same cleared target and equipped wood. The owner's separate Chromium client pressed the test-only place key, sending a normal native interaction packet. The native log recorded `w_1691d6c278d35fbde places node default:wood at (129,11,-256)`, and the retained `town-packet-owner-place-result.txt` says `PASS owner browser place changed own claimed node`. The same run retained passing outsider dig/place, wallet reconnect, and full Luanti/Node restart markers.

This proves one allowed owner edit through the browser, as well as the denied outsider actions. It still uses CI-granted town quota and a disposable browser key binding. The later current-head run above adds owner browser digging; invited-member edits, live testnet payment delivery, and a remote deployment remain unverified.

## Real browser place packet denied in a claimed town — 2026-10-22 EDT

[Actions run 39822133926](https://github.com/cupOJoseph/minemine/actions/runs/39822133926) passed the native smoke workflow with two distinct SIWE-authenticated Chromium wallets in one Luanti world. The CI-only probe equipped the outsider with `default:wood`, kept an owner-placed wood node as the backing surface inside a nine-column claim, cleared the adjacent placement target, and aimed the outsider at that surface. The test pressed a place key in the browser client; the pinned WASM engine sent a normal native interaction packet through the wallet-authenticated bridge. The server log recorded `w_3bab0dcd2538f5585 tried to place default:wood at protected position (1,6,384)`. The retained `town-packet-place-result.txt` says `PASS outsider browser place reached protected air without changing it`.

This run also retained `PASS` markers for browser dig denial, wallet reconnect, and a clean Luanti/Node restart that preserved inventory, the owner-placed node, the nine-column claim, and owner/outsider protection. The test injects a place-key binding into the disposable browser fixture because headless Chromium's synthetic pointer movement disrupts right-click aiming; production key bindings are unchanged. The quota came from a CI fixture, not an ERC-20 purchase. The later runs above verify allowed owner dig/place; invited-member edits, remote-host behavior, and confirmation/reorg behavior after a real testnet purchase remain open.

## Real browser dig packet denied in a claimed town — 2026-10-22 EDT

[Actions run 39817450263](https://github.com/cupOJoseph/minemine/actions/runs/39817450263) passed the full native smoke workflow with two distinct SIWE-authenticated Chromium wallets connected to one Luanti world. After the CI-only town probe created a nine-column claim, the server placed a stone wall inside it and teleported the outsider beside it. The retained `packet-target.png` and `packet-aimed.png` show the actual game canvas, steel pickaxe and protected stone wall under the crosshair. Playwright locked the canvas pointer, held the left mouse button, and the probe reset the test character's camera during that hold to account for headless Chromium's synthetic pointer movement. The native log then recorded `w_3bab0dcd2538f5585 tried to dig default:stone at protected position (257,8,-384)`. The `town-packet-dig-result.txt` marker reported `PASS outsider browser dig reached protected node without changing it`, with the stone still present. The same run passed the earlier owner/outsider dig/place handler checks, wallet reconnect inventory/claim check, and full-stack restart inventory/node/claim check.

This establishes that a **browser-generated dig packet** enters native Luanti and is denied by the town claim. The quota was a CI fixture, not an ERC-20 purchase. The later place-packet run above verifies the corresponding browser placement denial. The CI probe and its camera controls are installed only in the disposable test world.

## Protected dig/place node handlers with two wallet players — 2026-10-22 EDT

[Actions run 39807363914](https://github.com/cupOJoseph/minemine/actions/runs/39807363914) extended the disposable native probe after two signed-wallet Chromium characters joined. At a loaded position inside the owner's nine-column claim, it placed a stone test node, called Luanti's `core.dig_node` with the connected outsider's `ObjectRef`, and verified the stone remained. It then called the same handler with the owner and verified the node became air. It called `core.place_node` with a wood node and the outsider, verified the space remained air, then called it with the owner and verified wood appeared. The native log records the outsider's protected dig/place attempts and the owner's successful dig/place at `(-64,20,64)`. The later full-stack restart probe verified the placed wood persisted with the claim and inventory.

The pinned Luanti server packet handler calls these same `node_on_dig` and `item_OnPlace` script handlers after its packet and anti-cheat checks. This earlier probe enters those handlers through the server Lua API with real connected players. The browser tests above add actual Chromium input packets for both denied actions.

## Native world restart retains wallet inventory and town protection — 2026-10-22 EDT

[Actions run 39805125951](https://github.com/cupOJoseph/minemine/actions/runs/39805125951) repeated the same sequence while also stopping and restarting the Node wallet/API and WebSocket service. The retained artifact has separate pre- and post-restart Node startup logs, both wallets re-signed through the new service process, and both rejoined Luanti under their original names. The saved inventory and nine-column town protection probe passed again. This verifies recovery after a clean restart of **both local processes**; it does not establish a remote-host backup drill, actual dig/place denial, or testnet payment delivery.

[Actions run 39802141973](https://github.com/cupOJoseph/minemine/actions/runs/39802141973) passed a full CI-only native-world restart sequence. Two signed-wallet Chromium clients joined, a nine-column quota fixture funded a town claim, and the first wallet character received three diamonds in a main inventory slot. After the browser reconnect probe passed, the workflow sent Luanti SIGTERM, waited for its clean exit, and restarted the same SQLite-backed world. Both wallets signed in again and joined under their original character names. The retained `town-probe-restart-result.txt` reports `PASS inventory, paid-size claim and owner/outsider protection survive native restart`; the native restart log independently contains both join records and that probe result. The probe read the same three-diamond stack, confirmed `core.is_protected` allowed the owner and denied the outsider at the saved claim position, and checked `/town info` still reported 9/9 protected columns.

The first run verified persistence across a **native Luanti process restart** in one disposable CI world; the later run adds the Node process restart. Neither run verifies a remote host, actual dig/place packets, confirmed on-chain payment delivery, or a production backup restore with player data.

## Native wallet reconnect retains inventory and town protection — 2026-10-22 EDT

[Actions run 39786849274](https://github.com/cupOJoseph/minemine/actions/runs/39786849274) passed the two-wallet Chromium/native Luanti smoke test with an extended CI-only probe. The probe placed three diamonds in the first wallet character's main inventory, confirmed the fixture was set, and maintained the previously verified nine-column claim. After the first browser closed and Luanti logged its disconnect, the same wallet signed in again and joined under the same character name. The probe then read three diamonds from the same inventory slot and confirmed the second wallet still could not build at the claimed position through `core.is_protected`. This proves inventory and claim behavior across a disconnect and rejoin while the server remains running. It does not prove inventory/claim restoration after a server restart, actual dig/place packet denial, or paid on-chain quota delivery.

## Native wallet reconnect retains character identity — 2026-10-22 EDT

[Actions run 39785092018](https://github.com/cupOJoseph/minemine/actions/runs/39785092018) repeated the two-wallet and town-protection checks, closed the first Chromium game page, waited for native Luanti to log that character leaving or timing out, requested a new SIWE session from the same EOA, and required a second native `joins game` record for the same derived character name. The other wallet browser remained open during this sequence. This proves a disconnected browser can reauthenticate and rejoin under the same wallet-derived identity. The later run above adds an inventory fixture check.

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
