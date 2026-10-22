import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnsResolver } from '../server/ens.mjs';

const address = '0x1111111111111111111111111111111111111111';
test('ENS reverse name is displayed only when forward resolution matches', async () => {
  const rpc = { getNetwork: async () => ({ chainId: 1n }), lookupAddress: async () => 'builder.eth', resolveName: async () => address };
  const ens = createEnsResolver(null, rpc);
  assert.equal(await ens.name(address), 'builder.eth');
  assert.deepEqual(await ens.recipient('builder.eth'), { address, ensName: 'builder.eth' });
  rpc.resolveName = async () => '0x2222222222222222222222222222222222222222';
  assert.equal(await ens.name(address), null);
});
test('ENS lookup validates mainnet and recipient input', async () => {
  const rpc = { getNetwork: async () => ({ chainId: 11155111n }) };
  const ens = createEnsResolver(null, rpc);
  assert.deepEqual(await ens.recipient(address), { address, ensName: null });
  await assert.rejects(ens.recipient('builder.eth'), /mainnet/);
  await assert.rejects(ens.recipient('builder.eth '), /Enter a wallet/);
  await assert.rejects(ens.recipient('builder.example'), /valid Ethereum/);
});
