# Third-party notices and source obligations

This source snapshot does not include a downloaded Luanti engine, WASM binary, or Minetest Game. Generated `public/engine/` and fetched `vendor/` trees are intentionally excluded from Git.

| Component | Role | License / review |
| --- | --- | --- |
| ethers 6.16.0 | Wallet-signature verification and RPC reads | MIT; exact transitive versions/integrities in package-lock.json |
| OpenZeppelin Contracts 4.9.6 | Prototype ERC-20 implementation | MIT; older pinned line chosen from available cache, review before release |
| solc 0.8.26 | Local Solidity compiler | Compiler package and bundled compiler notices retained in installation; review exact distribution licenses |
| @foundry-rs/anvil 1.7.1 | Development-only local Ethereum test node | MIT OR Apache-2.0; platform packages/integrities are pinned in package-lock.json; excluded from production dependencies |
| paradust7/luanti-wasm | Candidate build wrapper | Repository reports MIT for wrapper; bundled dependencies have separate licenses |
| OpenSSL 3.5.9 | Browser TLS/crypto build dependency | Apache-2.0; upstream `LICENSE.txt` is copied into the staged browser notices. |
| curl 8.23.0 | Browser HTTP transport | curl license; upstream `COPYING` is copied into the staged browser notices. |
| libarchive 3.8.10 | Browser game-pack/archive handling | BSD-style license and third-party notices in upstream `COPYING`, copied into the staged browser notices. |
| libzip 1.11.4 | Browser ZIP handling | Upstream `LICENSE` copied into staged browser notices. |
| zstd (pinned commit `f8745da6`) | Browser compression | Upstream `LICENSE` copied into staged browser notices. |
| paradust7/webshims (pinned commit `70653a91`) | Browser socket and system shims | Upstream `LICENSE` copied into staged browser notices. |
| Luanti engine | Actual native/WASM game engine | Preserve its LGPL notices and applicable source/relinking obligations; inspect pinned distribution |
| Minetest Game | Initial reference game/content | Code and media licenses vary; inspect pinned game notices before redistribution |
| Landing page game images | Source game preview and two direct captures from our browser playtest | Pinned [Minetest Game source](https://github.com/luanti-org/minetest_game/tree/c42e4d0c0ff9d27ff7b9b308c3cfc14098dd3a0f) and [CC BY-SA 3.0 media license](https://github.com/luanti-org/minetest_game/blob/c42e4d0c0ff9d27ff7b9b308c3cfc14098dd3a0f/LICENSE.txt); see `public/screenshots/NOTICE.txt` for origin and changes. |
| coi-serviceworker 0.1.7 | Response isolation headers for the GitHub Pages fallback | MIT; gzuidhof/coi-serviceworker commit 7b1d2a092d0d2dd2b7270b6f12f13605de26f214; unmodified script and full license in playtest/hosting |

Every binary release needs corresponding source references, local patch history, build instructions and retained license texts for the engine, renderer, Lua, libraries, game and media. A wrapper's MIT license does not relicense its dependencies. Validate obligations for the actual bundled artifacts rather than relying on this overview.
