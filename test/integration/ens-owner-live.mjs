import assert from 'node:assert/strict';
import { addEnsContracts } from '@ensdomains/ensjs';
import { getOwner as getV1Owner } from '@ensdomains/ensjs/public/v1';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { createEnsOwnership } from '../../server/ens-ownership.mjs';

const rpcUrl = process.env.ENS_RPC_URL;
if (!rpcUrl) throw new Error('Set ENS_RPC_URL to an Ethereum mainnet RPC URL.');
const client = createPublicClient({ chain: addEnsContracts(mainnet), transport: http(rpcUrl, { timeout: 8000 }) });
const record = await getV1Owner(client, { name: 'vitalik.eth' });
assert.equal(record?.ownershipLevel, 'registrar');
assert.ok(record.registrant);
const ens = createEnsOwnership(rpcUrl);
assert.deepEqual(await ens.verify('vitalik.eth', record.registrant), { name: 'vitalik.eth', version: 'v1' });
if (record.owner?.toLowerCase() !== record.registrant.toLowerCase()) {
  await assert.rejects(ens.verify('vitalik.eth', record.owner), { status: 403 });
}
console.log('PASS mainnet ENS registrar ownership and manager-only denial.');
