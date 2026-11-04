import { addEnsContracts } from '@ensdomains/ensjs';
import { getOwner } from '@ensdomains/ensjs/public/v2';
import { computeResolverResource, RESOLVER_ROLE_SET_ADDRESS } from '@ensdomains/ensjs/utils/v2';
import { getAddress } from 'ethers';
import { createPublicClient, http, keccak256, parseAbi, toHex, zeroAddress, zeroHash } from 'viem';
import { namehash } from 'viem/ens';
import { mainnet } from 'viem/chains';
import { NameRegistryError, normalizeHandle } from './name-registry.mjs';

const parent = 'minemine.eth';
const parentLabel = BigInt(keccak256(toHex('minemine')));
const minimumParentTermMs = 373 * 24 * 60 * 60 * 1000; // Longest first year plus one week to fulfill.
const registryAbi = parseAbi([
  'function getResolver(string) view returns (address)',
  'function getSubregistry(string) view returns (address)',
  'function getExpiry(uint256) view returns (uint64)',
]);
const resolverAbi = parseAbi([
  'function getRecordId(bytes32) view returns (uint256)',
  'function hasRoles(uint256,uint256,address) view returns (bool)',
]);

function unavailable(message) { throw new NameRegistryError(message, 'ens_sale_unavailable'); }

// Read-only gate for the internal test Checkout creator. It rejects an
// unconfigured parent, an existing subname token/record, wildcard defaults,
// and a resolver writer without ETH-address permission. Recheck before any
// eventual ENS write: onchain state can change after this read.
export function createManagedNamePreflight({ rpcUrl, expectedOwner, writerAddress, now = Date.now, client: suppliedClient }) {
  let owner;
  let writer;
  try { owner = getAddress(expectedOwner); writer = getAddress(writerAddress); }
  catch { throw new Error('ENS expected owner and writer addresses must be configured.'); }
  if (owner === zeroAddress || writer === zeroAddress || (!rpcUrl && !suppliedClient)) {
    throw new Error('ENS mainnet RPC, expected owner and writer must be configured.');
  }
  const client = suppliedClient || createPublicClient({ chain: addEnsContracts(mainnet), transport: http(rpcUrl, { timeout: 8000 }) });
  const registry = client.chain.contracts.ensRegistry.address;
  return async input => {
    const handle = normalizeHandle(input);
    const name = `${handle}.${parent}`;
    try {
      if (await client.getChainId() !== 1) unavailable('ENS sale requires Ethereum mainnet.');
      if (getAddress(await getOwner(client, { name: parent })) !== owner) unavailable('MineMine ENS parent control is not verified.');
      const [resolver, subregistry, expiry] = await Promise.all([
        client.readContract({ address: registry, abi: registryAbi, functionName: 'getResolver', args: ['minemine'] }),
        client.readContract({ address: registry, abi: registryAbi, functionName: 'getSubregistry', args: ['minemine'] }),
        client.readContract({ address: registry, abi: registryAbi, functionName: 'getExpiry', args: [parentLabel] }),
      ]);
      if (resolver === zeroAddress || subregistry !== zeroAddress) unavailable('MineMine ENS resolver is not ready for managed names.');
      if (BigInt(expiry) * 1000n <= BigInt(now() + minimumParentTermMs)) unavailable('MineMine ENS parent must be renewed before selling a full year.');
      if (await getOwner(client, { name }) !== zeroAddress) unavailable('This ENS subname already has an owner.');
      const [linkedRecord, defaultRecord] = await Promise.all([
        client.readContract({ address: resolver, abi: resolverAbi, functionName: 'getRecordId', args: [namehash(name)] }),
        client.readContract({ address: resolver, abi: resolverAbi, functionName: 'getRecordId', args: [zeroHash] }),
      ]);
      if (linkedRecord !== 0n || defaultRecord !== 0n) unavailable('This ENS resolver has an existing or default record.');
      const coinResource = computeResolverResource({ kind: 'address', coinType: 60n });
      const [rootWriter, ethWriter] = await Promise.all([
        client.readContract({ address: resolver, abi: resolverAbi, functionName: 'hasRoles', args: [0n, RESOLVER_ROLE_SET_ADDRESS, writer] }),
        client.readContract({ address: resolver, abi: resolverAbi, functionName: 'hasRoles', args: [coinResource, RESOLVER_ROLE_SET_ADDRESS, writer] }),
      ]);
      if (!rootWriter && !ethWriter) unavailable('MineMine ENS record writer is not authorized.');
      return { name, parentOwner: owner, resolver, writer,
        parentExpiresAt: new Date(Number(expiry) * 1000).toISOString() };
    } catch (error) {
      if (error instanceof NameRegistryError) throw error;
      unavailable('ENS sale preflight is temporarily unavailable.');
    }
  };
}
