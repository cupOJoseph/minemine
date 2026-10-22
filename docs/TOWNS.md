# Town land credits and protection protocol

Status: **local-EVM contract and API verified; fixture-backed Luanti owner, outsider, and member browser edits verified**. [Native run 39839625595](https://github.com/cupOJoseph/minemine/actions/runs/39839625595) proved that a claimed world denied an outsider's browser dig/place, accepted the owner's and invited member's browser dig/place, and denied that member's placement after removal. Inventory and claim state survived a clean Luanti/Node restart. The credits came from a CI fixture, not a token purchase. This is a Sepolia/local-chain prototype, not a mainnet economy. A purchased “block” means one **x/z land column protected at every height**. A town owner can combine purchases to claim multiple square areas. The contract uses a one-time, non-refundable price chosen at deployment. Price, treasury, token allocation, and permanence need a game-economy review before any real-value launch.

## Data flow

1. A wallet signs in to the MineMine Node service through the existing EOA SIWE flow. Its stable Luanti name is derived from its address, never from an ENS display name.
2. The owner uses the wallet lab to buy 1–4096 columns. The browser reads `allowance(owner, TownBlocks)` from the configured MINE contract. If needed, it asks the wallet to approve the exact purchase amount. It then submits `TownBlocks.buyBlocks(count)` from that same wallet.
3. `TownBlocks` transfers `count × pricePerBlock` MINE from the buyer to the immutable treasury and increments `purchased[buyer]` in the same EVM transaction. Failed transfers revert the credit change. The contract emits `BlocksPurchased` for auditability; no client-provided transaction hash is credited.
4. After the configured confirmation depth, the authenticated `POST /api/towns/sync` reads cumulative `purchased(wallet)` at an older block, checks chain ID and token address, and atomically writes a private `WORLD_DIR/town_quotas/<player>.json`. The server never trusts a client-reported balance.
5. The Luanti `town_claims` mod reads only that private file when an owner issues `/town claim <radius>`. It compares purchased columns with the sum of existing claims, rejects overlaps, and saves town state in mod storage. The standard `core.is_protected` hook blocks digging and placement by nonmembers within a claim.

This separates on-chain spending from per-block gameplay. Mining and building do not make a blockchain transaction. Purchases can be retried safely: the service reads the contract's cumulative total, not a replayable receipt. A purchase is not claimable until the quota file is synced.

## Contract and testnet configuration

Deploy MINE first with an isolated Sepolia or local-chain key. Set `TOKEN_ADDRESS`, `RPC_URL`, `TOWN_TREASURY`, and `TOWN_PRICE_PER_BLOCK` in the untracked `.env` file. The town treasury can equal the token treasury but must be intentionally chosen. Then run:

```sh
npm run contracts:compile
npm run towns:deploy
```

The deployment script refuses chains other than Sepolia (11155111) and local Anvil (31337), waits for two confirmations, and writes an ignored deployment record under `artifacts/`. Review and verify the contract source and recorded address before setting `TOWN_CONTRACT_ADDRESS`. Never put `DEPLOYER_PRIVATE_KEY` in browser code, logs, chat, or Git. The running Node service needs an RPC URL but no signing key.

`TOWN_CONFIRMATIONS` defaults to six on Sepolia and cannot be set below six there. Local chain 31337 defaults to zero for tests. The quota read uses `latest - confirmationDepth`; this reduces short reorg exposure but is not absolute finality. A deep reorg or malicious RPC could leave previously claimed land overcredited. Require a trusted RPC and a chain finality/security review before public economic use.

## In-game commands

The owner creates one town with `/town create <name>`, then stands at a desired center and uses `/town claim <radius>`. The claim covers a square of `(2 × radius + 1)²` x/z columns, at all heights. Radius is 1–16. Claims cannot overlap another town's area or protection reported by an earlier protection mod at the claim height. `/town unclaim` removes the claim the owner is standing in and makes those purchased columns available for another claim.

`/town info` shows protected and purchased columns. `/town invite <wallet player name>` creates an invitation; the invited player uses `/town accept <owner wallet player name>`. Owners use `/town kick <member>`; members use `/town leave`. A player belongs to at most one town. Membership lets players build within the town but never bypasses another mod's protection.

The mod is installed by `node scripts/setup-world.mjs` in a **new** development world alongside `wallet_auth`. For an existing world, review and copy the mod manually, enable `load_mod_town_claims = true`, and back up `world.mt`, mod storage, and world data first. Node and Luanti must share `WORLD_DIR` privately under a dedicated user. `wallet_grants`, `wallet_balances`, and `town_quotas` must stay outside the public web root. Keep Luanti mod security enabled.

## Verification still required

- Check formspec interactions, bucket/liquid behavior, explosions, pistons/machines, and other mods. `core.is_protected` covers standard protection-aware actions; custom mods may need their own checks.
- Test two wallets buying credits on Sepolia and syncing confirmed quotas into the native world, then repeat town creation, member access, overlap checks, reconnect, and save/reload against those purchased credits.
- Confirm the wallet UI handles approval success, purchase failure, page close, changed wallet account, and delayed confirmations without claiming success early.
- Review treasury custody, price, refund policy, land scarcity, anti-griefing, moderation, and contract security before real-value deployment.

The implementation follows [Luanti's protection-mod interoperability guidance](https://docs.luanti.org/for-creators/mod-interoperability/) and [OpenZeppelin's ERC-20/SafeERC20 interfaces](https://docs.openzeppelin.com/contracts/4.x/api/token/erc20).
