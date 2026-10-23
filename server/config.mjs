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
  if (env.GAME_ENABLED === 'true' && env.GAME_ADDRESS && env.GAME_ADDRESS !== '10.0.0.1') throw new Error('The restricted game proxy requires GAME_ADDRESS=10.0.0.1.');
  const townConfirmations = Number(env.TOWN_CONFIRMATIONS ?? (chainId === 31337 ? 0 : 6));
  if (!Number.isInteger(townConfirmations) || townConfirmations < 0 || townConfirmations > 64) throw new Error('Invalid town confirmation depth.');
  if (chainId === 11155111 && townConfirmations < 6) throw new Error('Sepolia town credits require at least six confirmation blocks.');
  if (env.TOWN_CONTRACT_ADDRESS && (!env.TOKEN_ADDRESS || !env.RPC_URL)) throw new Error('Town contract requires TOKEN_ADDRESS and RPC_URL.');
  const trustedLoopbackProxy = env.TRUST_LOOPBACK_PROXY === 'true';
  if (trustedLoopbackProxy && (origin.protocol !== 'https:' || !['127.0.0.1', '::1'].includes(env.HOST || '127.0.0.1'))) {
    throw new Error('TRUST_LOOPBACK_PROXY requires HTTPS and a loopback HOST.');
  }
  return {
    origin: origin.origin, host: env.HOST || '127.0.0.1', port, chainId,
    secure: origin.protocol === 'https:',
    trustedLoopbackProxy,
    worldDir: path.resolve(env.WORLD_DIR || './runtime/world'),
    gameEnabled: env.GAME_ENABLED === 'true', adapterReady: env.ENGINE_ADAPTER_READY === 'true',
    gameAddress: env.GAME_ADDRESS || '10.0.0.1', gamePort,
    tokenAddress: env.TOKEN_ADDRESS ? getAddress(env.TOKEN_ADDRESS) : null,
    rpcUrl: env.RPC_URL || null,
    ensRpcUrl: env.ENS_RPC_URL || null,
    townContractAddress: env.TOWN_CONTRACT_ADDRESS ? getAddress(env.TOWN_CONTRACT_ADDRESS) : null,
    townConfirmations,
  };
}
