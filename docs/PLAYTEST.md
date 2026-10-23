# Browser playtest build

Current status: the solo playtest works at https://cupojoseph.github.io/minemine/. The real engine compiled successfully in Actions run 39147984307. Release 96f0d5d5fc25 contains a 13,926,500-byte WASM and 21,300,742 bytes of recorded assets. Local asset hashes and the public WASM match the manifest. Startup, movement, mouse look, inventory, digging, building, clean exit and saved-world reload passed in Chromium on 2026-10-18 after correcting a reserved-name startup error. See VALIDATION.md for exact evidence and remaining QA.

The newer local candidate `21f97a29c16b` has a 15,242,948-byte WASM and 22,617,218 recorded asset bytes. `scripts/benchmark-solo.mjs` records loopback browser transfers and startup callback timing; see VALIDATION.md for the named M3/Chromium setup and limits. The proposed Caddy ingress now compresses the WASM with zstd or gzip. A local HTTPS Chromium launch passed through that proxy, reducing measured first-context transfer from about 22.6 MB to 12.6 MB. This does not measure real network startup, game FPS, peak memory or the first controllable frame. The upgraded candidate and new MineMine landing remain unpublished pending PR review.

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

Use an up-to-date desktop browser that passes the runtime WebGL 2, SharedArrayBuffer/cross-origin-isolation, and JSPI checks. Browser support must be measured; no Firefox/Safari support claim is made. The Node service supplies the required COOP/COEP headers, streams large binaries, and permits the engine's dynamic styling/menu handlers only under /engine/. Wallet pages retain their stricter CSP.

A public host needs HTTPS, application/wasm for the binary, COOP same-origin, and COEP require-corp. Do not use an arbitrary static host without checking those headers and asset-size limits.

For personal Vercel hosting, `node scripts/prepare-vercel-playtest.mjs` validates the recorded engine asset hashes and prepares an isolated static deployment folder with the necessary headers. It uploads no auth server or wallet state. Account selection and a successful deployment remain separate steps; preparation alone does not publish anything.

GitHub Pages is the other authorized host. The manual Publish Miners solo playtest workflow accepts a successful WASM build run ID and downloads only that repository's public build artifact. A value of 0 publishes a clearly labeled prerequisite check, with no engine or gameplay claim. Pages cannot set the required response headers directly; a pinned MIT-licensed coi-serviceworker is scoped to this project's path and applies COOP/COEP to fetched responses. Its credentialless fallback is disabled. The first visit can reload once, and its effectiveness must be verified in the real browser before relying on Pages. No wallets, backend credentials or world data are uploaded. Browser-saved worlds stay on the user's device.

## Core smoke test and remaining QA

- Real WASM compile succeeds; retain the compiler version and full build log.
- All engine/game requests succeed and no third-party network proxy is contacted.
- Reach the first controllable frame, move, dig a block, and place a block.
- Open inventory and verify the starter items and creative controls.
- Quit using the menu, reload, and verify the same world edits persist.
- Test startup failure, unsupported browser, second tab/storage lock, and reload.
- Record hardware, browser version, cold/warm start duration, real game frame times, and memory.
- Publish to HTTPS and repeat the core smoke test at the final URL.

The core gameplay smoke test above passed at the public URL. Unsupported-browser behavior, second-tab/storage-lock contention, performance measurements and extended stability remain additional QA. The artifact records browserVerified: false because packaging cannot establish browser behavior; consult VALIDATION.md for runtime results tied to a specific launcher revision.

## Current build status

GitHub access was restored on 2026-10-18. After correcting fresh-checkout handling, libarchive cross-compilation, static libzip and fail-fast execution, run 39147984307 compiled and packaged the engine successfully. Its full build log is retained by GitHub and locally at runtime/wasm-build-39147984307.log. Browser control recovered and the core public gameplay/persistence smoke test passed. Launcher/configuration fixes can now be published against that engine artifact without recompiling WASM. No additional GitHub or hosting scope is required.
