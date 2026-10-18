# Browser playtest build

Current status: engine source is pinned; solo launcher and packaging are implemented and tested at the JavaScript level. The engine has not been compiled or played in this environment. There is no verified playtest URL yet.

## First playtest scope

The first engine test is a small local creative world using the actual Luanti engine and Minetest Game. The starter inventory includes a steel pickaxe, dirt, wood, and torches. Browser storage is used when supported. Shared multiplayer, wallet-gated characters, and token rewards/spending remain separate milestones.

The playtest launcher uses the downloaded upstream LuantiLauncher/LuantiArgs classes. It waits for engine readiness and the bundled game pack, supplies a fixed local world path, and passes no wallet credentials or URL passwords. External network proxies and the ContentDB endpoint are disabled. Singleplayer behavior without a proxy still needs to be tested in the real engine; this is not established by the adapter tests.

## Build on GitHub Actions

The WASM workflow is prepared for the exact source revision recorded in upstream.sources.json.

1. Push the reviewed project and source lock to cupOJoseph/minemine.
2. Open Actions → Build Luanti browser playtest (experimental) → Run workflow.
3. A successful run produces the miners-solo-playtest artifact. Failed builds retain diagnostic profile/CMake files when available.

The Linux workflow installs Node 24, CMake, Tcl, wget, zstd, gettext, and other build tools. Upstream installs Emscripten 6.0.8 and its patches; this still needs a real compile. The former Node 22 workflow could not satisfy the inspected installer.

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

## Acceptance before sending a playtest link

- Real WASM compile succeeds; retain the compiler version and full build log.
- All engine/game requests succeed and no third-party network proxy is contacted.
- Reach the first controllable frame, move, dig a block, and place a block.
- Open inventory and verify the starter items and creative controls.
- Quit using the menu, reload, and verify the same world edits persist.
- Test startup failure, unsupported browser, second tab/storage lock, and reload.
- Record hardware, browser version, cold/warm start duration, real game frame times, and memory.
- Publish to HTTPS and repeat the core smoke test at the final URL.

The artifact records browserVerified: false because packaging cannot establish those results. Do not convert that flag to true or call the playtest ready until the checks have been performed.

## Current build status

GitHub access was restored on 2026-10-18 and the project was pushed to cupOJoseph/minemine. The first Linux Actions run passed the JavaScript tests, then exposed a fresh-checkout error in the source downloader before compilation. The downloader now handles an unborn HEAD; a corrected build is the next validation step. Local real-HTTP wallet login also passes after correcting the test client's Host handling. No engine compile or playable deployment is claimed yet.
