import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { encodeAllowance, encodeApprove, encodeBuyBlocks, encodeTransfer, parseTokenAmount } from '../public/transfer.mjs';

test('wallet transfer encoding preserves exact 18-decimal amounts', () => {
  const recipient = '0x1111111111111111111111111111111111111111';
  const amount = parseTokenAmount('12.000000000000000001', 18);
  const iface = new Interface(['function transfer(address,uint256)']);
  assert.deepEqual(iface.decodeFunctionData('transfer', encodeTransfer(recipient, amount)).toArray(), [recipient, amount]);
});

test('town purchase calldata matches contract ABI', () => {
  const wallet = '0x1111111111111111111111111111111111111111';
  const town = '0x2222222222222222222222222222222222222222';
  const iface = new Interface(['function approve(address,uint256)', 'function allowance(address,address)', 'function buyBlocks(uint256)']);
  assert.deepEqual(iface.decodeFunctionData('approve', encodeApprove(town, 36n)).toArray(), [town, 36n]);
  assert.deepEqual(iface.decodeFunctionData('allowance', encodeAllowance(wallet, town)).toArray(), [wallet, town]);
  assert.deepEqual(iface.decodeFunctionData('buyBlocks', encodeBuyBlocks(36)).toArray(), [36n]);
});

test('wallet transfer input rejects malformed, zero, over-precise and oversized amounts', () => {
  for (const value of ['0', '00.2', '1e10', '-1', ' 1', '1.123']) assert.throws(() => parseTokenAmount(value, 2));
  assert.throws(() => parseTokenAmount('1', 37));
  assert.throws(() => parseTokenAmount('9'.repeat(80), 18));
  assert.throws(() => encodeTransfer('not-an-address', 1n));
});
