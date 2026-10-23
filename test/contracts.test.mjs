import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileTownBlocks } from '../scripts/compile-contracts.mjs';
test('token compiles and exposes ERC-20 and burn operations without privileged minting', () => {
  const artifact = compile();
  assert.match(artifact.compiler, /^0\.8\.26/);
  assert.ok(artifact.bytecode.length > 100);
  const names = artifact.abi.filter(i => i.type === 'function').map(i => i.name);
  for (const name of ['transfer', 'transferFrom', 'approve', 'allowance', 'balanceOf', 'totalSupply', 'burn', 'burnFrom']) assert.ok(names.includes(name), name);
  for (const name of ['mint', 'setTax', 'upgradeTo', 'owner']) assert.ok(!names.includes(name), name);
  assert.equal(artifact.abi.find(i => i.type === 'constructor').inputs[0].type, 'address');
});
test('town payment contract compiles with fixed token, price, and no administrative mint', () => {
  const artifact = compileTownBlocks();
  const names = artifact.abi.filter(i => i.type === 'function').map(i => i.name);
  for (const name of ['buyBlocks', 'purchased', 'token', 'treasury', 'pricePerBlock']) assert.ok(names.includes(name), name);
  for (const name of ['mint', 'setPrice', 'withdraw', 'upgradeTo']) assert.ok(!names.includes(name), name);
});
