import { FetchRequest, JsonRpcProvider, getAddress } from 'ethers';
import { AuthError } from './auth.mjs';

// ENS lives on mainnet even when the MINE contract is on Sepolia.
export function createEnsResolver(rpcUrl, providerOverride) {
  let provider = providerOverride;
  if (!provider && rpcUrl) {
    const request = new FetchRequest(rpcUrl);
    request.timeout = 8000;
    provider = new JsonRpcProvider(request);
  }
  async function mainnet() {
    if (!provider) throw new AuthError('ENS lookups are not configured.', 503);
    if (Number((await provider.getNetwork()).chainId) !== 1) throw new AuthError('ENS RPC must use Ethereum mainnet.', 503);
    return provider;
  }
  return {
    async name(address) {
      if (!provider) return null;
      const rpc = await mainnet();
      const candidate = await rpc.lookupAddress(getAddress(address));
      if (!candidate) return null;
      // Never display an unverified reverse record as the wallet's identity.
      const forward = await rpc.resolveName(candidate);
      return forward && getAddress(forward) === getAddress(address) ? candidate : null;
    },
    async recipient(input) {
      if (typeof input !== 'string' || input.length > 255 || !input.trim() || input !== input.trim()) throw new AuthError('Enter a wallet address or ENS name.', 400);
      try { return { address: getAddress(input), ensName: null }; } catch { /* Name path. */ }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.eth$/i.test(input) || input.includes('..')) throw new AuthError('Enter a valid Ethereum address or .eth name.', 400);
      const rpc = await mainnet();
      const address = await rpc.resolveName(input);
      if (!address) throw new AuthError('ENS name has no Ethereum address.', 404);
      return { address: getAddress(address), ensName: input.toLowerCase() };
    },
    close() { if (!providerOverride) provider?.destroy(); },
  };
}
