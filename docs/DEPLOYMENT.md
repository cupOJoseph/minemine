# Build and deployment runbook

The source is published at cupOJoseph/minemine and foundation CI passes. Linux WASM run 39147984307 succeeded and Pages deployment 39149469057 published the experimental solo bundle at https://cupojoseph.github.io/minemine/. Gameplay is unverified because browser control disconnected after deployment. There is no running shared game server.

## 1. GitHub and local environment

The only authorized project repository is `https://github.com/cupOJoseph/minemine`. The user supplied this destination on 2026-10-16. Use a fine-grained credential limited to that repository; do not authenticate with a general account-wide credential or create another repository.

A repository-scoped credential was supplied and authorized by the user. GitHub access is now working and commits have been pushed successfully. Contents and Pull requests read/write plus Workflows write cover code/CI work; Administration is unnecessary. Do not put credentials in remote URLs, source files, command arguments, or logs.

The active checkout is the nested minemine directory. Its main branch tracks origin/main. For subsequent source changes:

```sh
git status --short
git diff --check
git push origin main
```

Review staged files before each commit: `.env`, private keys, `runtime/`, `node_modules/`, and generated artifacts must not be committed. Use only access authorized for this repository. Do not force-push over existing remote work.

```sh
npm ci --ignore-scripts
npm test
npm run test:http
npm run contracts:compile
cp .env.example .env
npm start
```

Visit `http://localhost:3000`, connect a Sepolia wallet and sign the login message. Verify cancellation, invalid-signature rejection, account switching, logout and refresh. Confirm the Play button remains disabled while the engine is absent.

## 2. Fetch and lock upstream

```sh
npm run upstream:fetch -- --resolve
```

Inspect every downloaded repository and nested dependency lock. `--resolve` intentionally updates root commit pins from their specified refs and is not run automatically by CI. Review the diff and commit the completed source lock. Native engine ref `5.16.1` is an initial candidate observed in official package metadata; it still needs local resolution and compatibility testing against the WASM fork. No script silently falls back to another version.

## 3. Build WASM on Linux

Upstream documents Ubuntu and dependencies `build-essential`, `cmake`, and `tclsh`. The manual GitHub workflow installs the surrounding fetch/build utilities and invokes:

```sh
bash scripts/build-wasm.sh
```

The upstream script installs its patched Emscripten SDK. Expect a large initial build. Capture the log and disk/memory usage before assigning time budgets. If the build output changes from `www/index.html`, inspect the pinned upstream scripts and update staging explicitly.

Engine files remain ignored in Git. Publish build artifacts together with checksums, license notices and corresponding source references. The build script refuses to overwrite an existing `public/engine` directory.

## 4. Native server and game

Build the pinned official engine using its own platform instructions with client disabled and server enabled; follow that commit's dependency requirements. Use a run-in-place build if retaining the `vendor/native` layout. Install the pinned Minetest Game into its game search path as `minetest`. Do not assume the browser-client and native-server version/protocol match without a connection test.

Create the test world and install the auth mod:

```sh
node scripts/setup-world.mjs
```

Run the resulting server binary using `game/minetest.conf`, the configured `WORLD_DIR`, and game ID `minetest`. Native executable naming varies by engine version; confirm the name from that build. The config binds UDP to loopback and disables server-list advertising. Keep it private until the restricted proxy is working.

The Node service and Luanti must run as the same dedicated OS user (or use carefully scoped directory permissions) so Lua can read grant files with mode 0600. `WORLD_DIR/wallet_grants` must never be a static web directory. Keep mod security enabled; the mod reads only its world directory and needs no insecure environment or outbound HTTP permissions.

## 5. Implement the engine adapter and proxy

Read the pinned `static/launcher.js` and `webshims/src/emsocket/proxy.js`. Build a compatible restricted proxy with one fixed private Luanti target. Do not point wallet-authenticated play at third-party public proxies.

Create `public/engine/adapter.js` exporting:

```js
export async function launch({ container, ticket }) {
  // Implement against inspected upstream APIs.
  // ticket: { name, password, expiresAt, address, port }
  // Mount the engine, apply the ephemeral credentials in memory, connect.
}
```

This interface is a local contract, not an assertion that upstream has this API. Never send credentials via URL parameters or to an upstream demo. Ensure the engine does not persist the temporary password while saving its settings. Update CSP narrowly if the verified engine requires additional same-origin resources.

Complete B04/B05/S03/A05 in ROADMAP.md, then set `GAME_ENABLED=true` and `ENGINE_ADAPTER_READY=true`. The `/api/health` readiness flag checks configuration and adapter files; it does **not** probe native UDP availability. Add actual game/proxy liveness before production monitoring.

## 6. Host the tested stack

For the first solo browser test, native server hosting is unnecessary: both client and local world run in WASM. After downloading and verifying the engine artifact, `node scripts/prepare-vercel-playtest.mjs` creates an isolated deployment folder under runtime. Only the public engine bundle is copied; the server, auth state, world grants, dependencies and parent workspace are excluded. The generated Vercel configuration supplies COOP/COEP, engine CSP, WASM MIME type, and cache rules. The script verifies recorded asset sizes and SHA-256 hashes and refuses to replace an existing deployment folder. Deploy that generated folder only after explicitly selecting the verified personal Vercel scope. The account's existing CLI credential currently fails API authorization; no Vercel project has been created.

The user's approved hosting choices are their personal Vercel account or GitHub Pages. Do not deploy into a work team or provision additional paid services without an agreed budget. Standard Pages hosting cannot configure arbitrary response headers; any service-worker isolation approach would need a separate real-browser check before adopting it.

The remaining instructions apply to the future shared-server milestone:

Use a Linux host with persistent disk, adequate memory for the measured build/world, and HTTPS/WSS ingress. Start with a single region and single auth process. A public domain, provider account and budget are still needed.

The included `deploy/Dockerfile` can package the **Node launcher/auth service only**. It does not package a working native game server or proxy. Build from project root:

```sh
docker build -f deploy/Dockerfile -t miners-auth:dev .
```

Configure `PUBLIC_ORIGIN=https://your-domain`, TLS termination, same-origin WSS routing, and a private world directory shared with the native game process. Preserve the original Host header; the app validates it against PUBLIC_ORIGIN. Do not trust arbitrary forwarded headers. The current limiter groups clients behind a reverse proxy by proxy IP; replace it with a limiter at the trusted ingress before a multi-user launch.

Only expose web ports; native UDP remains private. Run a backup/restore drill, test restarts and disk exhaustion, and verify remote access from two browsers before advertising the server.

## 7. Testnet currency

First execute the local-EVM tests tracked in E02. Set an isolated testnet RPC/key/treasury in `.env`, then run `npm run contracts:deploy`. Never paste a key into an issue, chat, shell command argument, or frontend file. The service itself does not use a deployment key.

Record deployment receipt and verify the source. Set `TOKEN_ADDRESS` and confirm authenticated balances against the configured chain. Reward minting, shops, escrow, deposit indexing and reorg recovery remain E05–E08 tasks; this deployment alone does not complete the in-game currency goal.
