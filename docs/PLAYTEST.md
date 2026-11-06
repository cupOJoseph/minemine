# Browser playtest build

Current status: the [MineMine landing](https://cupojoseph.github.io/minemine/) links to a playable [solo Luanti world](https://cupojoseph.github.io/minemine/play/) and a [dated test-world map](https://cupojoseph.github.io/minemine/map/). Browser release `22c4727b4d93` was built in [WASM run 42111328195](https://github.com/cupOJoseph/minemine/actions/runs/42111328195) and published in [Pages run 42157928099](https://github.com/cupOJoseph/minemine/actions/runs/42157928099). Fresh public Chromium reached the solo world and rendered terrain; clean exit and saved-world reload passed on an earlier release. The public game is still solo. See [VALIDATION.md](VALIDATION.md) and the [roadmap](ROADMAP.md) for the exact browser evidence and remaining release gates.

This release has a 15,242,230-byte WASM and 22,609,796 recorded asset bytes. `scripts/benchmark-solo.mjs` records loopback browser transfers and startup callback timing; see [VALIDATION.md](VALIDATION.md) for the named M3/Chromium setup and limits. The proposed Caddy ingress compresses the WASM with zstd or gzip. A local HTTPS Chromium launch of the previous release passed through that proxy, reducing measured first-context transfer from about 22.6 MB to 12.6 MB; the new binary has not repeated that proxy measurement. This does not measure real network startup, game FPS, peak memory or the first controllable frame. Firefox rendering and saved-world improvements passed local automated checks on the previous binary, while public Firefox gameplay still needs verification.

## First playtest scope

The first engine test is a small local creative world using the actual Luanti engine and Minetest Game. The starter inventory includes a steel pickaxe, dirt, wood, and torches. Browser storage is used when supported. Shared multiplayer, wallet-gated characters, and token rewards/spending remain separate milestones.

The playtest launcher uses the downloaded upstream LuantiLauncher/LuantiArgs classes. It waits for engine readiness and the bundled game pack, supplies a fixed local world path, and passes no wallet credentials or URL passwords. External network proxies and the ContentDB endpoint are disabled. The real engine's singleplayer mode worked without a proxy. Leave the name argument empty: supplying a name selects local multiplayer, which rejects the reserved singleplayer name.

## Build on GitHub Actions

The WASM workflow is prepared for the exact source revision recorded in upstream.sources.json.

1. Push the reviewed project and source lock to cupOJoseph/minemine.
2. Open Actions → Build Luanti browser playtest (experimental) → Run workflow.
3. A successful run produces the miners-solo-playtest artifact. Failed builds retain diagnostic profile/CMake files when available.

The Linux workflow installs Node 24, CMake, Tcl, wget, zstd, gettext, and other build tools. Upstream installs Emscripten 6.0.8 and its patches; the real compile succeeded. The former Node 22 workflow could not satisfy the inspected installer.

The build copies the pinned wrapper into an ignored runtime directory and patches that copy, preserving the downloaded checkout. Its default profile requests a 512 MiB initial heap with growth to at most 2 GiB and eight pre-created worker threads. The upstream settings were a 1,920 MiB initial heap and 22 workers. These are build configuration changes, not measured performance results. Runtime stability and memory growth must be tested.

The original game source is exported using git archive at the locked commit. The game pack contains the starter mod and local world metadata, with no wallet-auth mod or private runtime state. The build packages asset hashes, source commits, profile details, license notices, and the modified build script. Complete license/source compliance review before public distribution.

## Run the resulting bundle

Extract the artifact so that index.html, build.json, and the hashed release directory are inside this project's public/engine directory. Preserve nested paths; do not create an extra public/engine/engine directory.

On a machine that permits local sockets, run npm start.

Visit http://localhost:3000/engine/index.html. The main launcher also reveals a Solo playtest link when the expected bundle files exist. This means an engine bundle is installed, not that gameplay has been verified.

With the staged bundle served by `npm start`, `npm run test:firefox-opfs` runs a local headless Firefox check in a disposable browser profile. It opts into `?storage=auto`, places a dirt block, exits through the game menu, opens a fresh Firefox process, and requires a dig event for the same block. The command needs Playwright's Firefox browser installed and is not part of the default unit suite or proof of a public Firefox release.

`npm run test:storage-lock` checks saved-world tab contention in local headless Chromium; `BROWSER=firefox npm run test:storage-lock` checks Firefox with its OPFS opt-in. Each command starts one world tab, requires the second tab's busy dialog without a second join, then verifies the lock is released after both a clean game exit and closing a tab. Use a staged engine bundle and `npm start` first. These are local browser checks, not a guarantee against browser crashes or public-host storage behavior.

Use an up-to-date desktop browser that passes the runtime WebGL 2, SharedArrayBuffer/cross-origin-isolation, and JSPI checks. The local upgraded solo bundle rendered a world and opened inventory in Playwright WebKit 27.2 on macOS; that is a WebKit test, not validation of a shipping Safari release or persistent storage. An older published Firefox 157 bundle entered the solo world but showed a black viewport. The merged fix removed the disposable WebGL context probe and rendered terrain, inventory and movement in local headless Firefox. [Pages run 41865307906](https://github.com/cupOJoseph/minemine/actions/runs/41865307906) published the new launcher, and live HTTP serves its Firefox storage guidance; public Firefox gameplay still needs verification. The pinned engine starts Firefox in temporary memory mode by default. Its `?storage=auto` option mounted OPFS in a local Firefox test and retained both a moved player's position and a placed dirt block across a clean exit and fresh browser process. Some intermediate frames were black while the game continued to log actions, so longer-session performance still needs proof. See [VALIDATION.md](VALIDATION.md) for the exact result. The Node service supplies the required COOP/COEP headers, streams large binaries, and permits the engine's dynamic styling/menu handlers only under /engine/. Wallet pages retain their stricter CSP.

A public host needs HTTPS, application/wasm for the binary, COOP same-origin, and COEP require-corp. Do not use an arbitrary static host without checking those headers and asset-size limits.

For personal Vercel hosting, `node scripts/prepare-vercel-playtest.mjs` validates the recorded engine asset hashes and prepares an isolated static deployment folder with the necessary headers. It uploads no auth server or wallet state. Account selection and a successful deployment remain separate steps; preparation alone does not publish anything.

GitHub Pages hosts the current landing and solo playtest. The manual **Publish MineMine landing and solo playtest** workflow accepts a successful WASM build run ID and downloads only that repository's public build artifact. A value of `0` publishes a prerequisite check without an engine, so use the successful build run ID to preserve the playable site. Pages cannot set the required response headers directly; a pinned MIT-licensed coi-serviceworker is scoped to this project's path and applies COOP/COEP to fetched responses. Its credentialless fallback is disabled. A fresh visitor can reload once; three fresh Chromium sessions passed isolation and startup readiness after the first-visit recovery. No wallets, backend credentials or world data are uploaded. Browser-saved worlds stay on the user's device.

## Core smoke test and remaining QA

- Real WASM compile succeeds; retain the compiler version and full build log.
- All engine/game requests succeed and no third-party network proxy is contacted.
- Reach the first controllable frame, move, dig a block, and place a block.
- Open inventory and verify the starter items and creative controls.
- Quit using the menu, reload, and verify the same world edits persist.
- Test startup failure, unsupported browser, second tab/storage lock, and reload.
- Record hardware, browser version, cold/warm start duration, real game frame times, and memory.
- Publish to HTTPS and repeat the core smoke test at the final URL.

The core gameplay smoke test above passed at the public URL. Local second-tab/storage-lock contention passed in Chromium and Firefox with OPFS; public-origin and crash recovery remain. Unsupported-browser behavior, performance measurements and extended stability remain additional QA. The artifact records browserVerified: false because packaging cannot establish browser behavior; consult VALIDATION.md for runtime results tied to a specific launcher revision.

## Current build status

The first successful WASM compile was [run 39147984307](https://github.com/cupOJoseph/minemine/actions/runs/39147984307) on 2026-10-18, after correcting fresh-checkout handling, libarchive cross-compilation, static libzip and fail-fast execution. The current browser binary came from the libarchive 3.8.11 [build](https://github.com/cupOJoseph/minemine/actions/runs/42111328195) and was published by [Pages run 42157928099](https://github.com/cupOJoseph/minemine/actions/runs/42157928099). The full [native compatibility run](https://github.com/cupOJoseph/minemine/actions/runs/42156023805) passed, and a fresh public Chromium session joined the solo world and rendered terrain. Launcher and page changes can be published against a retained artifact without recompiling WASM, provided the artifact remains available and the Pages workflow is dispatched from `main` with that build run ID.
