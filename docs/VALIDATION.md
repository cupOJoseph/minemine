# Validation record

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
