# Miners

A browser-first Luanti (formerly Minetest) project with Ethereum wallet identity and an ERC-20 game-currency prototype.

**Status: engine integration in progress, not a playable release.** Source is pushed to [cupOJoseph/minemine](https://github.com/cupOJoseph/minemine), foundation CI passes, and the Linux engine build is being debugged. The browser wrapper, official engine, and Minetest Game are pinned. No multiplayer server is online and no token is deployed.

The [public browser compatibility check](https://cupojoseph.github.io/minemine/) passes the hosting/runtime prerequisites in Chromium, including cross-origin isolation, shared memory, JSPI and WebGL 2. It currently contains no playable engine. A successful compile and real movement/digging/building/save test are required before a playtest release.

See [the first browser playtest build](docs/PLAYTEST.md) for the prepared Linux workflow, bundle contents, and checks required before a playable link can be sent.

## What exists

- Responsive launcher with browser-wallet connection and Sign-In with Ethereum messages.
- Node service that verifies actual EOA signatures, binds challenges to browser cookies, prevents challenge replay, and creates expiring server-side sessions.
- Short-lived game-credential issuer and an **experimental, untested-in-engine** Lua authentication mod. Ordinary account registration is disabled by that mod.
- Fixed-supply `MineToken` ERC-20 source using OpenZeppelin, a local compiler, and a testnet-only deployment script.
- Authenticated on-chain balance endpoint and launcher display, enabled only with an RPC and token address.
- Source-fetch/locking scripts, WASM build workflow, tests, and a detailed [roadmap](docs/ROADMAP.md).

The illustration in the launcher is concept art, not a screenshot or substitute game. The external upstream demo is independent and does not use this project's wallet login.

## Run locally

Node 22.16 or newer is required. From this directory, on a machine that permits local sockets:

```sh
npm ci --ignore-scripts
cp .env.example .env
npm test
npm run test:http
npm run test:evm
npm start
```

Open `http://localhost:3000` (use that exact hostname to match `PUBLIC_ORIGIN`). For testing, enable an Ethereum browser wallet and switch to Sepolia when prompted. Signing in requests a message signature, not a transaction. No private key is ever requested by the website.

`npm test` runs in-process handler, signature, grant, configuration, and contract-compilation checks without opening a network port. `npm run test:http` separately tests actual HTTP sockets. `npm run test:evm` executes token transfers, allowances, burns and authenticated balance reads on an isolated local Anvil chain. These checks do not substitute for browser or native-engine testing.

This implementation supports EOA wallets. Contract wallets/ERC-1271, WalletConnect, mobile wallet deep links, multiple injected-provider discovery, and multi-server sessions are future tasks.

## Build the actual game

Read [architecture and upstream findings](docs/ARCHITECTURE.md), then [build and deployment](docs/DEPLOYMENT.md). Fetch the reviewed source lock without updating its pins:

```sh
npm run upstream:fetch
bash scripts/build-wasm.sh
```

The WASM build uses upstream's scripts on Linux with Node 24. It is unverified here. It stages the engine and a bundled local game at `public/engine/`; shared multiplayer still needs the wallet adapter and restricted proxy. Do not enable `GAME_ENABLED` or `ENGINE_ADAPTER_READY` to bypass the disabled shared-world Play button.

## Currency

```sh
npm run contracts:compile
```

The provisional token is **Miners Credit / MINE**, 18 decimals, with one million units minted to a specified treasury at deployment. Holders can burn tokens; there is no extra minting, upgrade control, or tax. This is an implementation choice for a test prototype, not a finalized token economy.

Deployment requires `RPC_URL`, `DEPLOYER_PRIVATE_KEY` (isolated testnet wallet), and `TOKEN_TREASURY`. Then run `npm run contracts:deploy`. The script refuses chains other than Sepolia (11155111) and local development (31337). It spends testnet gas and waits for two confirmations; no deployment was performed during setup. Set `TOKEN_ADDRESS` afterward to enable the balance endpoint. The game does not yet award or spend these tokens.

## Project map

| Path | Purpose |
| --- | --- |
| `public/` | Launcher; optional ignored engine bundle |
| `server/` | SIWE sessions, static serving, balance reads, join grants |
| `game/mods/wallet_auth/` | Experimental wallet-only Luanti auth handler |
| `contracts/` | Testnet currency source |
| `scripts/` | Source lock, builds, compiler, testnet deployment, diagnostics |
| `test/` | Offline checks and separate socket integration test |
| `docs/ROADMAP.md` | Task IDs, dependencies, acceptance criteria, blockers |

## Current environment blockers

Recorded 2026-10-16:

1. Shell DNS/network access to GitHub is unavailable, so the engine download failed.
2. The workspace denies `.git` writes, so `git init` failed.
3. `gh auth status` reports an invalid credential for `cupOJoseph`.
4. Docker, CMake, and Emscripten are absent.
5. Local TCP listeners fail with `EPERM`, preventing preview and live HTTP checks.

Dependencies were restored from the local npm cache with integrity checks, and `npm ci --offline` was verified with that prepared cache. Standard `npm ci` works from the committed lockfile when registry access is available. See [validation](docs/VALIDATION.md) for exact results and limits.

## Licensing

Original project code is MIT-licensed; see `LICENSE`. Luanti and games retain their own licenses. No upstream engine or game is redistributed in this snapshot. Before publishing a WASM bundle, preserve all upstream notices and provide corresponding modified source as required; see [third-party notices](THIRD_PARTY.md).
