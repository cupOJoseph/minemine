import { addEnsContracts } from '@ensdomains/ensjs';
import { getOwner } from '@ensdomains/ensjs/public/v2';
import { eacHasRolesSnippet } from '@ensdomains/ensjs-abi/v2/enhancedAccessControl';
import { getAddress } from 'ethers';
import { createPublicClient, http, keccak256, parseAbi, toHex, zeroAddress } from 'viem';
import { mainnet } from 'viem/chains';

const rpcUrl = process.env.ENS_RPC_URL;
if (!rpcUrl) throw new Error('Set ENS_RPC_URL to an Ethereum mainnet RPC URL.');
const client = createPublicClient({ chain: addEnsContracts(mainnet), transport: http(rpcUrl, { timeout: 8000 }) });
if (await client.getChainId() !== 1) throw new Error('ENS RPC must use Ethereum mainnet.');

const name = 'minemine.eth';
const registry = client.chain.contracts.ensRegistry.address;
const label = BigInt(keccak256(toHex('minemine')));
const owner = await getOwner(client, { name });
if (owner === zeroAddress) throw new Error(`${name} has no active ENSv2 owner.`);
const expectedOwner = process.env.ENS_EXPECTED_OWNER ? getAddress(process.env.ENS_EXPECTED_OWNER) : null;
const entryAbi = parseAbi([
  'function getResolver(string) view returns (address)',
  'function getSubregistry(string) view returns (address)',
  'function getExpiry(uint256) view returns (uint64)',
]);
const [resolver, subregistry, expiry, canSetResolver, canSetSubregistry] = await Promise.all([
  client.readContract({ address: registry, abi: entryAbi, functionName: 'getResolver', args: ['minemine'] }),
  client.readContract({ address: registry, abi: entryAbi, functionName: 'getSubregistry', args: ['minemine'] }),
  client.readContract({ address: registry, abi: entryAbi, functionName: 'getExpiry', args: [label] }),
  client.readContract({ address: registry, abi: eacHasRolesSnippet, functionName: 'hasRoles', args: [label, 1n << 24n, owner] }),
  client.readContract({ address: registry, abi: eacHasRolesSnippet, functionName: 'hasRoles', args: [label, 1n << 20n, owner] }),
]);
console.log(JSON.stringify({
  name,
  chainId: 1,
  owner,
  expectedOwnerMatches: expectedOwner === null ? null : expectedOwner === getAddress(owner),
  expiry: new Date(Number(expiry) * 1000).toISOString(),
  resolver,
  resolverConfigured: resolver !== zeroAddress,
  subregistry,
  ownerCanSetResolver: canSetResolver,
  ownerCanSetSubregistry: canSetSubregistry,
}, null, 2));
if (expectedOwner && expectedOwner !== getAddress(owner)) process.exitCode = 1;
