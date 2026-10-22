# MineMine

MineMine is a browser-first voxel crafting MMO project built on Luanti (formerly Minetest). The [current solo browser playtest](https://cupojoseph.github.io/minemine/) runs the compiled engine and Minetest Game; movement, mining, placement, inventory, crafting, and browser save/reload have been verified in Chromium. The new MineMine landing page is in this branch. The public shared world is **not online yet**.

## Current feature state

| Feature | State |
| --- | --- |
| Solo browser game | Playable in desktop Chromium; additional browser and stability checks remain |
| Public shared server | Two distinct wallet characters joined the same native world in headless Chromium; the town denied an outsider's browser dig/place packets and allowed the owner's browser dig/place. A clean Luanti and Node restart preserved a test inventory stack, separate owner-placed node, and town protection. Production backup recovery and a public host remain. |
| Wallet identity | Sign-In with Ethereum (EOA) and short-lived grants passed native login and same-wallet reconnect in CI; the patched browser engine passed the console credential check |
| ENS | Server-side mainnet name lookup and forward-verified display implemented; requires `ENS_RPC_URL` and live RPC QA |
| MINE ERC-20 | Fixed-supply source and local-EVM transfers tested; no public token deployed |
| In-game MINE balance | Wallet-panel refresh makes a fresh authenticated chain read; `/wallet balance` displays its short-lived private snapshot with chain and block. This observed balance cannot be spent as town credit. The native command passed CI with a synthetic snapshot; live testnet QA remains. |
| Wallet transfers | Direct browser-wallet transaction UI implemented; needs deployed testnet token and browser-wallet QA |
| Town protection | Payment contract and confirmed quota sync implemented; a quota fixture passed two-wallet native dig/place handler, member, browser outsider denial, owner browser dig/place, and restart checks. Live paid claims and invited-member browser edits remain |
| SpacetimeDB | [Migration plan](docs/SPACETIMEDB.md) for the next scaling phase; not yet integrated |

The landing page distinguishes playable features from planned ones and uses two actual playtest captures plus an attributed Minetest Game screenshot. The large Play Now link starts solo mode without a wallet.

## Run locally

Node 22.16+ is required. From this checkout:

```sh
npm ci --ignore-scripts
cp .env.example .env
npm test
npm run test:http
npm run test:evm
npm start
```

Open the origin in `PUBLIC_ORIGIN` (default `http://localhost:3000`). `npm test` and Solidity compilation do not open sockets. The HTTP and EVM suites use local sockets. The ignored `public/engine/` bundle must be staged separately for local Play Now; on a fresh checkout the button points to the published playtest. Run `npm run adapter:install` after staging a verified engine bundle to add the remote-client frame; it requests a fresh wallet game ticket only after engine and content-pack loading.

Wallet login requests a message signature, not a transaction. MINE sends and town purchases **do** request testnet transactions and gas. The app never asks for a wallet private key. This prototype supports externally owned accounts, Sepolia or local chain 31337, and an optional mainnet ENS RPC. See [deployment](docs/DEPLOYMENT.md) and [town protocol](docs/TOWNS.md).

## Build and publish the browser playtest

The pinned WASM wrapper, engine and Minetest Game sources are in [upstream.sources.json](upstream.sources.json). `bash scripts/build-wasm.sh` builds the engine on the documented Linux toolchain and stages it in ignored `public/engine/`. A successful build artifact can be supplied to the manual Pages workflow. The Pages package now puts this landing page at the root and the solo game at `/play/`; `scripts/prepare-pages-playtest.mjs` verifies engine hashes and prepares that layout. GitHub Pages is static and does not run wallet auth or the multiplayer game server.

Do not enable `GAME_ENABLED` or `ENGINE_ADAPTER_READY` until the native server, wallet grants, proxy and adapter pass a remote two-player smoke test. The current in-page shared-world button remains disabled.

## Repository map

- `public/` — MineMine landing page, real gameplay captures, browser-wallet UI.
- `playtest/` — actual Luanti solo launcher and browser hosting files.
- `server/` — SIWE sessions, ENS resolution, on-chain reads, private quota sync and join grants.
- `contracts/` — fixed-supply MINE and testnet town land-credit payment contract.
- `game/mods/` — experimental wallet authentication and town protection mods.
- `docs/ROADMAP.md` — acceptance criteria and remaining integration gates.
- `docs/VPS_RECOMMENDATION.md` — researched first public-world hosting size, cost, and launch gates.

MineMine is independent of the Luanti team. Original project code is MIT-licensed; upstream engine and game files retain their own licenses. See [third-party notices](THIRD_PARTY.md).
