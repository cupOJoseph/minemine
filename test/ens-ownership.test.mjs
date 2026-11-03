import test from 'node:test';
import assert from 'node:assert/strict';
import { zeroAddress } from 'viem';
import { createEnsOwnership } from '../server/ens-ownership.mjs';

const alice = '0x1111111111111111111111111111111111111111';
const bob = '0x2222222222222222222222222222222222222222';
function fixture(overrides = {}) {
  const calls = [];
  const state = {
    chain: 1,
    v2: {},
    v1: {},
    expiry: {},
    ...overrides,
  };
  const ens = createEnsOwnership(null, {
    client: { getChainId: async () => state.chain },
    v2Owner: async (_client, { name }) => { calls.push(['v2', name]); return state.v2[name] ?? zeroAddress; },
    v1Owner: async (_client, { name }) => { calls.push(['v1', name]); return state.v1[name] ?? null; },
    v1Expiry: async (_client, { name, contract }) => { calls.push(['expiry', name, contract]); return state.expiry[name] ?? null; },
  });
  return { ens, calls, state };
}

test('exact ENSv2 ownership accepts a normalized name, including a DNS name, without trusting resolution', async () => {
  const { ens, state, calls } = fixture({ v2: { 'bücher.eth': alice, 'alice.example': alice } });
  assert.deepEqual(await ens.verify('Bücher.eth', alice), { name: 'bücher.eth', version: 'v2' });
  assert.deepEqual(await ens.verify('alice.example', alice), { name: 'alice.example', version: 'v2' });
  assert.deepEqual(calls, [['v2', 'bücher.eth'], ['v2', 'alice.example']]);
  state.v2['bücher.eth'] = bob;
  await assert.rejects(ens.verify('Bücher.eth', alice), { status: 403 });
});

test('unmigrated .eth ownership requires an active registrar and actual NFT or wrapper owner', async () => {
  const { ens, state } = fixture({
    expiry: { 'builder.eth': { status: 'active' }, 'sub.builder.eth': { status: 'active' } },
    v1: {
      'builder.eth': { ownershipLevel: 'registrar', owner: bob, registrant: alice },
      'sub.builder.eth': { ownershipLevel: 'nameWrapper', owner: alice },
    },
  });
  assert.deepEqual(await ens.verify('builder.eth', alice), { name: 'builder.eth', version: 'v1' });
  await assert.rejects(ens.verify('builder.eth', bob), { status: 403 }, 'registrar manager is not the NFT owner');
  assert.deepEqual(await ens.verify('sub.builder.eth', alice), { name: 'sub.builder.eth', version: 'v1' });
  state.expiry['sub.builder.eth'] = { status: 'expired' };
  await assert.rejects(ens.verify('sub.builder.eth', alice), { status: 403 });
  state.expiry['sub.builder.eth'] = { status: 'active' };
  state.expiry['builder.eth'] = { status: 'gracePeriod' };
  await assert.rejects(ens.verify('sub.builder.eth', alice), { status: 403 });
});

test('migrated parent blocks stale v1 subname ownership, and unavailable ownership fails closed', async () => {
  const { ens, state } = fixture({
    v2: { 'builder.eth': bob },
    expiry: { 'builder.eth': { status: 'active' } },
    v1: { 'sub.builder.eth': { ownershipLevel: 'registry', owner: alice } },
  });
  await assert.rejects(ens.verify('sub.builder.eth', alice), { status: 403 });
  assert.equal((await createEnsOwnership(null).verify('builder.eth', alice).catch(error => error)).status, 503);
  state.v2 = {};
  state.chain = 11155111;
  await assert.rejects(ens.verify('builder.eth', alice), { status: 503 });
  state.chain = 1;
  state.v2['builder.eth'] = 'bad RPC response';
  await assert.rejects(ens.verify('builder.eth', alice), { status: 503 });
  await assert.rejects(ens.verify('builder.eth ', alice), { status: 400 });
});
