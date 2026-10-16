import path from 'node:path';
import { getAddress } from 'ethers';

export function readConfig(env = process.env) {
  const origin = new URL(env.PUBLIC_ORIGIN || 'http://localhost:3000');
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('PUBLIC_ORIGIN must be an origin, without path, query or credentials.');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) throw new Error('Public deployments require HTTPS.');
  const chainId = Number(env.CHAIN_ID || 11155111);
  if (![11155111, 31337].includes(chainId)) throw new Error('This milestone supports Sepolia or local chain 31337 only.');
  const port = Number(env.PORT || 3000);
  const gamePort = Number(env.GAME_PORT || 30000);
  if (![port, gamePort].every(p => Number.isInteger(p) && p > 0 && p < 65536)) throw new Error('Invalid port.');
  return {
    origin: origin.origin, host: env.HOST || '127.0.0.1', port, chainId,
    secure: origin.protocol === 'https:',
    worldDir: path.resolve(env.WORLD_DIR || './runtime/world'),
    gameEnabled: env.GAME_ENABLED === 'true', adapterReady: env.ENGINE_ADAPTER_READY === 'true',
    gameAddress: env.GAME_ADDRESS || '127.0.0.1', gamePort,
    tokenAddress: env.TOKEN_ADDRESS ? getAddress(env.TOKEN_ADDRESS) : null,
    rpcUrl: env.RPC_URL || null,
  };
}
