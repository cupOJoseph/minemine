import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Contract, getAddress } from 'ethers';
import { AuthError } from './auth.mjs';

const abi = [
  'function token() view returns (address)',
  'function pricePerBlock() view returns (uint256)',
  'function purchased(address) view returns (uint256)',
];

export function createTownCredits(config, provider) {
  const dir = path.join(config.worldDir, 'town_quotas');
  const contract = config.townContractAddress && provider ? new Contract(config.townContractAddress, abi, provider) : null;
  async function status(address) {
    if (!contract) return { configured: false };
    if (Number((await provider.getNetwork()).chainId) !== config.chainId) throw new AuthError('Town RPC uses the wrong chain.', 503);
    const latest = await provider.getBlockNumber();
    const blockNumber = latest - config.townConfirmations;
    if (blockNumber < 0) throw new AuthError('Waiting for town purchase confirmations.', 503);
    const blockTag = blockNumber;
    const [token, price, purchased] = await Promise.all([
      contract.token({ blockTag }), contract.pricePerBlock({ blockTag }), contract.purchased(address, { blockTag }),
    ]);
    if (getAddress(token) !== config.tokenAddress) throw new AuthError('Town contract uses a different MINE token.', 503);
    if (price <= 0n || purchased < 0n || purchased > 1_000_000n) throw new AuthError('Town contract returned invalid credits.', 503);
    return { configured: true, address: config.townContractAddress, token, purchasedBlocks: Number(purchased), pricePerBlockRaw: price.toString(), confirmationDepth: config.townConfirmations, blockNumber, chainId: config.chainId };
  }
  return {
    status,
    async sync(session) {
      if (!/^w_[0-9a-f]{17}$/.test(session.playerName)) throw new AuthError('Invalid player identity.', 400);
      const value = await status(session.address);
      if (!value.configured) throw new AuthError('Town payments are not configured.', 503);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const target = path.join(dir, session.playerName + '.json');
      try {
        const old = JSON.parse(readFileSync(target, 'utf8'));
        if (old.address?.toLowerCase() !== session.address.toLowerCase()) throw new AuthError('Town identity collision.', 409);
        if (old.block_number > value.blockNumber) return { ...value, purchasedBlocks: old.blocks, blockNumber: old.block_number };
      } catch (error) { if (error instanceof AuthError) throw error; }
      const record = { name: session.playerName, address: session.address, blocks: value.purchasedBlocks, block_number: value.blockNumber };
      const temporary = target + '.' + randomBytes(8).toString('hex') + '.tmp';
      try {
        writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
        renameSync(temporary, target);
      } finally { rmSync(temporary, { force: true }); }
      return value;
    },
  };
}
