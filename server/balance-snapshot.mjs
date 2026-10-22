import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AuthError } from './auth.mjs';

export function writeBalanceSnapshot(config, session, balance, now = Date.now()) {
  if (!/^w_[0-9a-f]{17}$/.test(session.playerName) || !/^0x[0-9a-fA-F]{40}$/.test(session.address)) {
    throw new AuthError('Invalid player identity.', 400);
  }
  if (!balance.configured || balance.address !== config.tokenAddress || balance.chainId !== config.chainId ||
      !/^\d+$/.test(balance.raw) || !/^\d+(?:\.\d+)?$/.test(balance.formatted) ||
      !Number.isInteger(balance.decimals) || balance.decimals < 0 || balance.decimals > 36 ||
      !Number.isSafeInteger(balance.blockNumber) || balance.blockNumber < 0) {
    throw new AuthError('Invalid observed balance.', 503);
  }
  const dir = path.join(config.worldDir, 'wallet_balances');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, session.playerName + '.json');
  try {
    const old = JSON.parse(readFileSync(target, 'utf8'));
    if (old.address?.toLowerCase() !== session.address.toLowerCase()) throw new AuthError('Balance identity collision.', 409);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error.code !== 'ENOENT') throw new AuthError('Existing balance snapshot is invalid.', 409);
  }
  const record = {
    name: session.playerName, address: session.address, token: balance.address,
    chain_id: balance.chainId, raw: balance.raw, formatted: balance.formatted,
    decimals: balance.decimals, block_number: balance.blockNumber,
    observed_at: balance.observedAt, expires_at: Math.floor(now / 1000) + 60,
  };
  const temporary = target + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, target);
  } finally { rmSync(temporary, { force: true }); }
  return record;
}
