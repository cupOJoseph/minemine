import { createPublicClient, http, isErc6492Signature } from 'viem';

// This RPC must be the chain named in MineMine's server-generated SIWE message.
// Viem's public action covers deployed ERC-1271 and undeployed ERC-6492 wallets.
export function createSmartSignatureVerifier({ chainId, rpcUrl }) {
  if (!rpcUrl) return null;
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 8000 }) });
  return async ({ address, message, signature }) => {
    if (await client.getChainId() !== chainId) throw new Error('Smart-wallet RPC chain mismatch.');
    if (!isErc6492Signature(signature)) {
      const code = await client.getCode({ address });
      if (!code || code === '0x') return false;
    }
    return client.verifyMessage({ address, message, signature });
  };
}
