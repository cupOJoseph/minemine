# Architecture and feasibility findings

Decision date: 2026-10-16; implementation updated 2026-10-23. Working name: MineMine. No claim of affiliation with Luanti.

## Reuse the engine

Luanti is the current name of Minetest. Compile an existing C++ port to WebAssembly rather than write an unrelated voxel renderer and call it Minetest. Keep mods and authoritative world simulation on a native server. Browser wallets remain in ordinary browser JavaScript.

Candidate: [paradust7/luanti-wasm](https://github.com/paradust7/luanti-wasm), formerly `minetest-wasm`. Its README describes an experimental Emscripten build, `build_all.sh`, `www/` output, required response headers, OPFS persistence, and network proxies. This is evidence of feasibility, not a verification of our build or a claim of production readiness.

The [pinned wrapper](../upstream.sources.json) references dedicated engine and webshims forks. Its original fetch script bundled OpenSSL 1.1.1n, curl 7.82.0 and libarchive 3.6.1. A prepared build copy now fetches hash-locked OpenSSL 3.5.9, curl 8.23.0 and libarchive 3.8.10, with narrow compatibility patches. [WASM run 39900170530](https://github.com/cupOJoseph/minemine/actions/runs/39900170530) built that stack and preserved source notices. Dependency and binary license review remains a public release gate; see [validation](VALIDATION.md).

Other ports surfaced during discovery, including Kaesual and ford442 variants. Their source/build behavior was not verified in this session. Reassess them if the selected candidate fails the compatibility, dependency or performance gate.

## Planned runtime topology

```mermaid
flowchart TD
  B["Browser: wallet + WASM client"] -->|"HTTPS: signature and session"| A["Node auth service"]
  B -->|"WSS: game transport"| P["Restricted protocol proxy"]
  P -->|"Private UDP"| L["Native Luanti server"]
  A -->|"Two-minute join grants"| G["Private world grant directory"]
  L -->|"Read grants"| G
  L --> W["Persistent world and mods"]
  A -->|"Read balances"| R["Testnet JSON-RPC"]
```

The solo WASM bundle has passed Chromium gameplay and persistence checks. The Node service, grant issuer, wallet UI, and experimental Lua mods are implemented. The pinned browser adapter and restricted proxy passed source/protocol tests and two distinct Chromium wallet characters joined the same native server in CI. The pinned engine originally printed its startup arguments, including the short-lived ticket, to the browser console; a prepared-source patch removed that dump and the rebuilt artifact passed both browser credential-safety checks.

Browsers cannot open the native UDP sockets required by Luanti. The inspected pinned webshims client uses `NEWADDR`, `BIND`, and a 24-byte UDP envelope. The Node proxy implements those messages on same-origin WebSockets, checks a live wallet session and origin, caps connections, buffered bytes and ingress traffic, and forwards only to `127.0.0.1:GAME_PORT`. The browser targets fixed virtual address `10.0.0.1` because webshims keeps loopback packets in the browser; the proxy rejects TCP and every other UDP destination. A real WebSocket/UDP loopback test and two credential-safe browser-to-native joins pass. Browser edits, wallet reconnect, and a clean server restart have also passed locally in CI; public-host behavior remains unverified. The [upstream sample proxy](https://github.com/paradust7/minetest-wasm-sample-proxy) informed protocol research, and the [ws server API](https://github.com/websockets/ws/blob/master/doc/ws.md) informed upgrade handling. Evaluate WebTransport only after a working WebSocket baseline and measured head-of-line blocking.

The available Sites host is a Cloudflare Workers environment and cannot run a long-lived native UDP game server. A Linux VM/container host is required for the world and matching proxy. A static frontend could later live on a CDN with compatible isolation headers, but a single-origin deployment is simplest initially. On the planned host, Caddy overwrites a dedicated client-IP header for the Node API limiter. Node trusts it only from loopback with explicit HTTPS and loopback configuration, so visitors receive separate request budgets without accepting a public client's forwarded header.

## Identity boundary

1. Browser obtains an EOA address and the configured test-chain ID.
2. Server issues an exact [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) message with domain, URI, chain, nonce, issuance and expiry. An HttpOnly cookie binds the request to the browser.
3. Browser asks the wallet for `personal_sign`. Server recovers the signer using ethers, consumes the challenge, and establishes an opaque HttpOnly session.
4. Authenticated browser requests short-lived native-game credentials only when the engine adapter is explicitly enabled.
5. Player name is `w_` plus 17 hexadecimal characters of a SHA-256 wallet-address digest (19 total characters, within the pinned browser client's name limit). Full addresses are stored in grants and checked for mapping collisions.
6. After the WASM engine and game pack load, its same-origin frame requests a fresh ticket. The 256-bit random password is passed in memory through `LuantiArgs`; only the Luanti-compatible legacy hash is stored in the private world grant file. Grants expire after two minutes and are revoked on logout when owned by that session.
7. Lua custom authentication denies arbitrary registration and password changes. It grants only `interact` and `shout` by default.

The native legacy-hash authentication path passed two distinct Chromium-to-native joins after its base64 padding was corrected to Luanti's unpadded format. CI has checked owner/outsider/member town privileges and rejection of an expired ticket hash while its connected player retains ordinary access. A later native probe rejected arbitrary account creation, password changes and deletion through the registered auth handler, and verified default wallet privileges. A fresh Chromium client replayed an originally accepted password after its server grant expired; Luanti rejected the join and accepted a later signed reconnect. The grant is time-limited rather than single-use, and established play can outlive ticket expiry. Logout revokes the cookie and grant, closes the WebSocket bridge links, and the wallet mod promptly kicks the connected character when a grant is removed or replaced. Public-host replay, client-packet registration/escalation, session expiry and bans remain A05/A06 gates.

EOA-only verification is intentional for this milestone. ERC-1271 contract wallets require chain-specific RPC validation. The browser session store is in memory: a restart logs users out and clears outstanding grants. Only one auth process may own the world directory. No distributed coordination is implied.

## Currency boundary

The [OpenZeppelin ERC-20](https://docs.openzeppelin.com/contracts/4.x/erc20) implementation provides token accounting. Prototype supply is minted once to a specified treasury. No game-server mint key exists. The launcher reads balances from the configured chain, returning decimal-safe strings and observation metadata.

Gameplay should remain off-chain. Mining events, inventory changes and movement must not trigger transactions. Future reward and purchase flows require authoritative server events, idempotent processing, finality/reorg policy and durable fulfillment records. A balance display alone is not a usable in-game economy.

## Hosting and performance

Serve WASM as `application/wasm`, with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on applicable documents. Maintain secure context and same-origin worker resources. CSP permits only the exact same-origin WebSocket endpoint, not arbitrary proxy or script origins. The remote launcher runs in a same-origin iframe because the pinned runtime replaces its own document body.

Optimize measured world-rendering, map-loading and asset delivery bottlenecks. Record native-server and browser-client metrics separately. OPFS persistence in the upstream client is not a replacement for backups of the authoritative multiplayer world.
