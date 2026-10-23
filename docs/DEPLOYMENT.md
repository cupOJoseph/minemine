# Build and deployment runbook

The source is published at cupOJoseph/minemine and foundation CI passes. Linux WASM run 39147984307 succeeded, and the existing Pages deployment publishes the solo bundle at https://cupojoseph.github.io/minemine/. Movement, mining, placement, inventory, crafting and saved-world reload have since passed browser QA. The MineMine landing page is staged in this feature branch but not yet published. The Pages environment permits deployments only from `main`; feature-branch dispatch run 39723016671 failed before any steps ran. There is no running shared game server.

## 1. GitHub and local environment

The only authorized project repository is `https://github.com/cupOJoseph/minemine`. The user supplied this destination on 2026-10-16. Use a fine-grained credential limited to that repository; do not authenticate with a general account-wide credential or create another repository.

Repository-scoped access pushed the feature branch and created [PR #1](https://github.com/cupOJoseph/minemine/pull/1). Do not put credentials in remote URLs, source files, command arguments, or logs.

The active checkout is the nested minemine directory. Its main branch tracks origin/main. For subsequent source changes, use a feature branch and pull request:

```sh
git switch -c feature/<topic>
git status --short
git diff --check
git add <reviewed-files>
git commit -m "Describe the focused change"
git push -u origin feature/<topic>
gh pr create --base main --head feature/<topic>
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

Visit `http://localhost:3000`, connect a Sepolia wallet and sign the login message. Verify cancellation, invalid-signature rejection, account switching, logout and refresh. Confirm the shared-world button remains disabled while the adapter, proxy and server are absent. The separate Play Now link opens the solo engine when staged locally.

## 2. Fetch and lock upstream

```sh
npm run upstream:fetch -- --resolve
```

Inspect every downloaded repository and nested dependency lock. `--resolve` intentionally updates root commit pins from their specified refs and is not run automatically by CI. Review the diff and commit the completed source lock. The pinned native Luanti `5.16.1` build has now completed real wallet-authenticated Chromium joins against the pinned WASM client in CI. No script silently falls back to another version.

## 3. Build WASM on Linux

Upstream documents Ubuntu and dependencies `build-essential`, `cmake`, and `tclsh`. The manual GitHub workflow installs the surrounding fetch/build utilities and invokes:

```sh
bash scripts/build-wasm.sh
```

The upstream script installs its patched Emscripten SDK. Expect a large initial build. Capture the log and disk/memory usage before assigning time budgets. If the build output changes from `www/index.html`, inspect the pinned upstream scripts and update staging explicitly.

Engine files remain ignored in Git. Publish build artifacts together with checksums, license notices and corresponding source references. The build script refuses to overwrite an existing `public/engine` directory.

## 4. Native server and game

Build the pinned official engine using its own platform instructions with client disabled and server enabled; follow that commit's dependency requirements. Use a run-in-place build if retaining the `vendor/native` layout. Install the pinned Minetest Game into its game search path as `minetest`. Do not assume the browser-client and native-server version/protocol match without a connection test.

Create the test world and install the auth and town mods:

```sh
node scripts/setup-world.mjs
```

Run the resulting server binary using `game/minetest.conf`, the configured `WORLD_DIR`, and game ID `minetest`. Native executable naming varies by engine version; confirm the name from that build. The config binds UDP to loopback and disables server-list advertising. Keep it private until the restricted proxy is working. For an existing world, back up the world and install/enable `town_claims` manually; the setup script refuses to overwrite an existing `world.mt`.

The Node service and Luanti must run as the same dedicated OS user (or use carefully scoped directory permissions) so Lua can read grant, balance-snapshot, and quota files with mode 0600. `WORLD_DIR/wallet_grants`, `WORLD_DIR/wallet_balances`, and `WORLD_DIR/town_quotas` must never be static web directories. Keep mod security enabled; the mods read only their world directory and need no insecure environment or outbound HTTP permissions.

## 5. Verify the engine adapter and proxy

The pinned `static/launcher.js` and `webshims/src/emsocket/proxy.js` were inspected. `server/game-proxy.mjs` implements their `NEWADDR`/`BIND` and 24-byte UDP envelope on the same Node origin. It authenticates WebSocket upgrades with the wallet session cookie, checks Origin and Host, accepts no TCP requests, and sends UDP only to `127.0.0.1:GAME_PORT`. The browser uses fixed virtual destination `GAME_ADDRESS=10.0.0.1`, since webshims routes `127.0.0.1` inside the browser. The bridge accepts only that virtual destination. The real-socket test in `test/integration/game-proxy.mjs` verifies wallet login, private forwarding and rejection of unrelated destinations. Do not point wallet-authenticated play at third-party public proxies.

The remote adapter source lives in `playtest/adapter.js`, `connect.html`, `remote.js`, and `remote-session.mjs`. A new build stages these files automatically. For an existing verified local bundle, run:

```sh
npm run adapter:install
```

The in-page `launch({container})` creates a same-origin frame because the pinned runtime replaces its own document body. After the engine and Minetest Game pack load, the frame requests a fresh two-minute game ticket over the existing cookie session and passes it to `LuantiArgs` in memory. The ticket is absent from URLs, storage and console logging. The frame's CSP permits only same-origin WSS. Verify native-game handshake, browser storage/log behavior, frame isolation and logout disconnect before enabling live play.

Complete B05/S03/A05/S04 in ROADMAP.md, then set `GAME_ENABLED=true` and `ENGINE_ADAPTER_READY=true`. The wallet auth mod writes an atomic private-world heartbeat every two seconds. `/api/health` reports `nativeReady` only while that file is less than ten seconds old; `gameReady` also requires the enabled adapter and browser assets. A stale heartbeat disables new game tickets and the shared-world button on a fresh page load. This verifies that the native world is ticking, but does not prove the UDP proxy is reachable from an outside browser. Monitor both the web response and `nativeReady`, and keep the external two-wallet test as the launch gate.

## 6. Host the tested stack

For solo browser play, native server hosting is unnecessary: both client and local world run in WASM. The manual Pages workflow consumes a successful pinned engine artifact, verifies its hashes, and packages this branch's MineMine landing page at `/` and the solo game at `/play/`. Run `PAGES_SITE_DIR=/tmp/minemine-pages-check-20261022 node scripts/prepare-pages-playtest.mjs` locally with an unused output path to check the package without replacing earlier staging. On Pages, wallet lab APIs stay offline; only the solo game is served. `node scripts/prepare-vercel-playtest.mjs` remains an alternative isolated solo bundle path, but no Vercel project was created.

The user's approved solo-browser hosts are their personal Vercel account or GitHub Pages. They have also selected DigitalOcean for the future shared world with a strict $10/month ceiling and will connect that account when deployment is ready. Pages cannot run the native UDP game server or Node wallet service. The service-worker isolation path passed a Chromium solo-playtest check, but verify it again after moving the engine under `/play/`.

The remaining instructions apply to the future shared-server milestone:

Use a Linux host with persistent disk and HTTPS/WSS ingress. Start with a single region and single auth process. The [revised VPS recommendation](VPS_RECOMMENDATION.md) proposes a NYC3 1 GiB/1 vCPU Basic Droplet with daily backups for a $7.80/month listed base before tax and overages. A short two-wallet run passed with Luanti and Node inside a 1 GiB, zero-swap service cgroup; a whole-VM rehearsal and exact account charges still gate provisioning. DigitalOcean spend alerts are not hard caps. The owner will connect the account later. No VM or domain has been purchased. Use a temporary HTTPS address for the technical alpha; defer `minemine.gg` until the technology is viable and there is public interest.

The native CI [run 39915834630](https://github.com/cupOJoseph/minemine/actions/runs/39915834630) built and tested a relocated Ubuntu 22.04 x86-64 host archive with the upgraded browser client and two-player map-traffic limit. The named artifact `minemine-host-runtime-ubuntu22-x64` contains the pinned native binary/game, hash-verified WASM client and adapter, Node source and lockfile, mods, config, browser notices, and service templates. Its compressed archive is 18 MB; the example SHA-256 is `d045f1007ae02a8944f0f617862eda656c1839e7f7b1d6537ee2ca5db4363d87` and its CI merge checkout is `e83aaaa1c12abf0b29e42a27188d1119e07dc8fc`. Check the sidecar for the particular run used; this hash is not a blanket approval for future archives. The archive contains no world, grants or production configuration. GitHub may expire the artifact, in which case rerun the reviewed workflow and use the new checksum.

On a trusted workstation with repository access, download and check one successful reviewed run (replace the run ID if using a later build):

```sh
gh run download 39915834630 -n minemine-host-runtime-ubuntu22-x64 -D /tmp/minemine-host-download
cd /tmp/minemine-host-download
shasum -a 256 -c minemine-host-runtime-ubuntu22-x64.tar.gz.sha256
```

Copy the archive and sidecar to the Ubuntu 22.04 x86-64 VM through the approved SSH route. On that VM, check the checksum **again** before extracting. The following commands assume the files are in `/tmp/minemine-host-download` and are run by an administrator; the temporary HTTPS host, SSH access and spending check must already be settled:

```sh
cd /tmp/minemine-host-download
sha256sum -c minemine-host-runtime-ubuntu22-x64.tar.gz.sha256
sudo useradd --system --home-dir /srv/minemine --shell /usr/sbin/nologin minemine
sudo install -d -o minemine -g minemine -m 0750 /srv/minemine /srv/minemine/app /srv/minemine/world
sudo tar -C /srv/minemine/app -xzf minemine-host-runtime-ubuntu22-x64.tar.gz
sudo chown -R minemine:minemine /srv/minemine/app
cat /srv/minemine/app/BUILD_COMMIT
```

Use a fresh destination for each deployment; `useradd` is only for first setup. Install Node 24 so `/usr/bin/node` exists, plus Ubuntu 22.04 native runtime packages. The archive's `native-library-dependencies.txt` records the tested runner's shared libraries; install matching distribution packages and check the deployed binary with `ldd`. The main direct runtime packages on the tested runner include `zlib1g`, `libzstd1`, `libsqlite3-0`, `libjsoncpp25`, `libluajit-5.1-2`, `libgmp10`, `libncursesw6`, `libpq5`, and `libcurl3-gnutls`; their package names are corroborated by the [Ubuntu 22.04 server package dependencies](https://packages.ubuntu.com/jammy/minetest-server), and their dependencies come from apt. If the target distribution's package names or ABI differ, stop and rebuild the archive for that target instead of copying shared libraries from CI. Then:

```sh
ldd /srv/minemine/app/vendor/native/bin/luantiserver
test -z "$(ldd /srv/minemine/app/vendor/native/bin/luantiserver | grep 'not found' || true)"
sudo -u minemine -H sh -c 'cd /srv/minemine/app && npm ci --omit=dev'
sudo -u minemine -H sh -c 'cd /srv/minemine/app && WORLD_DIR=/srv/minemine/world /usr/bin/node scripts/setup-world.mjs'
```

Create `/etc/minemine/minemine.env` with owner `root`, group `minemine`, and mode `0640`. Start from the variable names in `.env.example` in the source repository, with `HOST=127.0.0.1`, `PORT=3000`, `PUBLIC_ORIGIN=https://<temporary-host>`, `WORLD_DIR=/srv/minemine/world`, `GAME_ENABLED=false`, and `ENGINE_ADAPTER_READY=false`. Set reviewed chain/RPC values only when needed. Do not put deployment keys in this service environment. Install the archived `deploy/vps/minemine-native.service` and `deploy/vps/minemine-web.service` under `/etc/systemd/system`, then run `sudo systemctl daemon-reload` and start both. The world heartbeat should make `/api/health` report `nativeReady: true`; with launch flags false, `gameReady` should be false. A fresh heartbeat proves the world ticked recently, not that a remote browser can reach the UDP bridge.

Install Caddy and adapt the archived `deploy/vps/Caddyfile.example` to the verified temporary hostname. Its automatic HTTPS needs the temporary hostname to resolve to the VM and ports 80/443 reachable. Validate the Caddyfile before starting Caddy. Keep Node 3000 and native UDP 30000 on loopback; permit only 80/443 and narrowly scoped SSH at the firewall. Check external HTTPS, WSS, COOP/COEP and `crossOriginIsolated`, then conduct the remote two-wallet joins, shared edits, reconnect, expired-ticket and authorization checks. Turn on both launch flags only for this controlled rehearsal; retain the button gate until those checks, backup/restore, and whole-VM resource measurements pass. Record a stopped-world backup and actually restore it. The [VPS gates](VPS_RECOMMENDATION.md#provisioning-and-launch-gates) remain authoritative before announcing a public URL.

The included `deploy/Dockerfile` packages the Node launcher/auth service and restricted WebSocket bridge. It does not package a native game server or a verified playable world. Build from project root:

```sh
docker build -f deploy/Dockerfile -t minemine-auth:dev .
```

Configure `PUBLIC_ORIGIN` to the exact temporary HTTPS origin, TLS termination, same-origin WSS routing, and a private world directory shared with the native game process. Preserve the original Host header; the app validates it against PUBLIC_ORIGIN. Do not trust arbitrary forwarded headers. The current limiter groups clients behind a reverse proxy by proxy IP; replace it with a limiter at the trusted ingress before a multi-user launch.

Only expose web ports; native UDP remains private. Run a backup/restore drill, test restarts and disk exhaustion, and verify remote access from two browsers before advertising the server.

## 7. Testnet currency

First execute the local-EVM tests tracked in E02. Set an isolated testnet RPC/key/treasury in `.env`, then run `npm run contracts:deploy`. Never paste a key into an issue, chat, shell command argument, or frontend file. The service itself does not use a deployment key.

Record deployment receipt and verify the source. Set `TOKEN_ADDRESS` and confirm authenticated balances against the configured chain. The wallet-panel balance refresh calls authenticated `POST /api/currency/sync` to read the configured token at a fresh block and write a 60-second private snapshot for the connected character. In Luanti, `/wallet balance` shows that observed amount, chain, and block. It is not a town credit or proof of a spendable in-game reward. Reward minting, shops, escrow, deposit indexing and reorg recovery remain E06–E08 tasks; this deployment alone does not complete the in-game currency goal.

## 8. ENS, direct transfers and protected towns

Set `ENS_RPC_URL` to an Ethereum-mainnet RPC to resolve ENS names, even while MINE runs on Sepolia. The service checks the ENS RPC chain and forward-verifies reverse names before display. Players send MINE directly through their browser wallets after a token is deployed and configured; the server never signs these transfers.

For prototype town payments, set `TOWN_TREASURY` and `TOWN_PRICE_PER_BLOCK`, then run `npm run towns:deploy`. Review its ignored deployment record, verify source and set `TOWN_CONTRACT_ADDRESS`. The wallet lab can then approve exact MINE allowance, buy credits, and sync confirmed totals into the private world. Sepolia quota sync reads at least six blocks behind the head. See [TOWNS.md](TOWNS.md) for commands, trust boundaries, test coverage and native-engine blockers.

Never deploy these prototypes to mainnet or advertise paid land until contract, wallet, chain-reorg, economy and native-game abuse reviews pass.
