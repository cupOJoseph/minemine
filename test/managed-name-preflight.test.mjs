import test from 'node:test';
import assert from 'node:assert/strict';
import { addEnsContracts } from '@ensdomains/ensjs';
import { computeResolverResource } from '@ensdomains/ensjs/utils/v2';
import { Wallet } from 'ethers';
import { toHex, zeroAddress, zeroHash } from 'viem';
import { namehash, packetToBytes } from 'viem/ens';
import { mainnet } from 'viem/chains';
import { createManagedNamePreflight } from '../server/managed-name-preflight.mjs';

const owner = new Wallet('0x' + '91'.repeat(32)).address;
const writer = new Wallet('0x' + '92'.repeat(32)).address;
const resolver = new Wallet('0x' + '93'.repeat(32)).address;
const now = Date.parse('2026-11-02T12:00:00Z');
const parentPacket = toHex(packetToBytes('minemine.eth'));
const childPacket = toHex(packetToBytes('builder.minemine.eth'));
const childNode = namehash('builder.minemine.eth');
const ethResource = computeResolverResource({ kind: 'address', coinType: 60n });

function fixture() {
  const state = { chainId: 1, parentOwner: owner, childOwner: zeroAddress, resolver,
    subregistry: zeroAddress, expiry: BigInt(Math.floor((now + 400 * 86_400_000) / 1000)),
    childRecord: 0n, defaultRecord: 0n, rootWriter: false, ethWriter: true, rpcError: false };
  const client = {
    chain: addEnsContracts(mainnet),
    async getChainId() { return state.chainId; },
    async readContract({ functionName, args }) {
      if (state.rpcError) throw new Error('RPC unavailable');
      if (functionName === 'findExactOwner') return args[0] === parentPacket ? state.parentOwner :
        args[0] === childPacket ? state.childOwner : zeroAddress;
      if (functionName === 'getResolver') return state.resolver;
      if (functionName === 'getSubregistry') return state.subregistry;
      if (functionName === 'getExpiry') return state.expiry;
      if (functionName === 'getRecordId') return args[0] === childNode ? state.childRecord :
        args[0] === zeroHash ? state.defaultRecord : 0n;
      if (functionName === 'hasRoles') return args[0] === 0n ? state.rootWriter :
        args[0] === ethResource ? state.ethWriter : false;
      throw new Error(`Unexpected ENS read: ${functionName}`);
    },
  };
  return { state, preflight: createManagedNamePreflight({ client, expectedOwner: owner, writerAddress: writer,
    now: () => now }) };
}

test('read-only ENS preflight accepts a free managed name with a scoped ETH writer and a full parent term', async () => {
  const { preflight } = fixture();
  const result = await preflight('BUILDER');
  assert.equal(result.name, 'builder.minemine.eth');
  assert.equal(result.parentOwner, owner);
  assert.equal(result.resolver, resolver);
  assert.equal(result.writer, writer);
  assert.ok(Date.parse(result.parentExpiresAt) > now + 373 * 86_400_000);
});

test('preflight closes sales for parent, subname, wildcard and writer conflicts', async () => {
  const cases = [
    [state => { state.chainId = 11155111; }, /mainnet/],
    [state => { state.parentOwner = writer; }, /parent control/],
    [state => { state.resolver = zeroAddress; }, /resolver/],
    [state => { state.subregistry = writer; }, /resolver/],
    [state => { state.expiry = BigInt(Math.floor((now + 372 * 86_400_000) / 1000)); }, /renewed/],
    [state => { state.childOwner = writer; }, /already has an owner/],
    [state => { state.childRecord = 1n; }, /existing or default record/],
    [state => { state.defaultRecord = 1n; }, /existing or default record/],
    [state => { state.ethWriter = false; }, /writer is not authorized/],
    [state => { state.rpcError = true; }, /temporarily unavailable/],
  ];
  for (const [change, message] of cases) {
    const { state, preflight } = fixture();
    change(state);
    await assert.rejects(preflight('builder'), { message });
  }
  const { state, preflight } = fixture();
  state.ethWriter = false;
  state.rootWriter = true;
  await preflight('builder');
  await assert.rejects(preflight('admin'), { code: 'invalid_handle' });
});
