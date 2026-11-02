import { addEnsContracts } from '@ensdomains/ensjs';
import { getExpiry as getV1Expiry, getOwner as getV1Owner } from '@ensdomains/ensjs/public/v1';
import { getOwner as getV2Owner } from '@ensdomains/ensjs/public/v2';
import { ensNormalize, getAddress } from 'ethers';
import { createPublicClient, http, zeroAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { AuthError } from './auth.mjs';

function normalizedName(value) {
  if (typeof value !== 'string' || value.length > 255 || value !== value.trim() || !value.includes('.')) {
    throw new AuthError('Enter a valid ENS name.', 400);
  }
  let name;
  try { name = ensNormalize(value); }
  catch { throw new AuthError('Enter a valid ENS name.', 400); }
  if (name.length > 255 || name.split('.').some(label => !label)) throw new AuthError('Enter a valid ENS name.', 400);
  return name;
}

// ENSv2 exposes the exact owner, while unmigrated .eth names still need
// ENSv1's registrar, registry, and NameWrapper ownership paths.
export function createEnsOwnership(rpcUrl, options = {}) {
  const client = options.client || (rpcUrl ? createPublicClient({ chain: addEnsContracts(mainnet), transport: http(rpcUrl, { timeout: 8000 }) }) : null);
  const v2Owner = options.v2Owner || getV2Owner;
  const v1Owner = options.v1Owner || getV1Owner;
  const v1Expiry = options.v1Expiry || getV1Expiry;
  return {
    async verify(value, account) {
      const name = normalizedName(value);
      let address;
      try { address = getAddress(account); }
      catch { throw new AuthError('Invalid wallet address.', 400); }
      if (!client) throw new AuthError('ENS ownership checks are not configured.', 503);
      try {
        if (await client.getChainId() !== 1) throw new AuthError('ENS RPC must use Ethereum mainnet.', 503);
        const exact = await v2Owner(client, { name });
        if (exact !== zeroAddress) {
          if (getAddress(exact) !== address) throw new AuthError('This wallet does not own that ENS name.', 403);
          return { name, version: 'v2' };
        }
        const labels = name.split('.');
        if (labels.at(-1) !== 'eth' || labels.length < 2) throw new AuthError('This wallet does not own that ENS name.', 403);
        // A migrated v2 ancestor makes legacy child records unsafe as proof.
        for (let index = 1; index < labels.length - 1; index++) {
          if (await v2Owner(client, { name: labels.slice(index).join('.') }) !== zeroAddress) {
            throw new AuthError('This wallet does not own that ENS name.', 403);
          }
        }
        const secondLevel = labels.slice(-2).join('.');
        if ((await v1Expiry(client, { name: secondLevel }))?.status !== 'active') {
          throw new AuthError('This ENS name is expired or inactive.', 403);
        }
        const record = await v1Owner(client, { name });
        if (!record) throw new AuthError('This wallet does not own that ENS name.', 403);
        if (record.ownershipLevel === 'nameWrapper' && name !== secondLevel &&
            (await v1Expiry(client, { name, contract: 'nameWrapper' }))?.status !== 'active') {
          throw new AuthError('This ENS name is expired or inactive.', 403);
        }
        const owner = name === secondLevel && record.ownershipLevel === 'registrar' ? record.registrant : record.owner;
        if (!owner || getAddress(owner) !== address) throw new AuthError('This wallet does not own that ENS name.', 403);
        return { name, version: 'v1' };
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError('ENS ownership lookup is temporarily unavailable.', 503);
      }
    },
  };
}
