import assert from 'node:assert/strict';
import { addEnsContracts } from '@ensdomains/ensjs';
import { getOwner as getV1Owner } from '@ensdomains/ensjs/public/v1';
import { getOwner as getV2Owner } from '@ensdomains/ensjs/public/v2';
import { createPublicClient, http, zeroAddress } from 'viem';
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
const v2Name = 'ur.integration-tests.eth';
const v2Owner = await getV2Owner(client, { name: v2Name });
assert.notEqual(v2Owner, zeroAddress);
assert.deepEqual(await ens.verify(v2Name, v2Owner), { name: v2Name, version: 'v2' });
console.log('PASS mainnet ENSv1 registrar ownership, manager-only denial and ENSv2 exact ownership.');
