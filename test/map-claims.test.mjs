import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClaims } from '../public/map/claims.mjs';
import { validateSpawn } from '../public/map/spawn.mjs';

test('public town projection accepts signed claim bounds without private account fields', () => {
  const claim = { town: 'Probe Town', x1: -3, x2: -1, z1: 7, z2: 9 };
  assert.deepEqual(validateClaims([claim]), [claim]);
  assert.throws(() => validateClaims([{ ...claim, owner: 'w_private' }]), /invalid/);
  assert.throws(() => validateClaims([{ ...claim, wallet: '0x1234' }]), /invalid/);
});

test('public spawn projection reveals only bounded world coordinates', () => {
  assert.deepEqual(validateSpawn({ x: -64, z: 72 }), { x: -64, z: 72 });
  assert.equal(validateSpawn(undefined), null);
  assert.throws(() => validateSpawn({ x: 0, z: 0, player: 'w_private' }), /Invalid/);
  assert.throws(() => validateSpawn({ x: 30928, z: 0 }), /Invalid/);
  assert.throws(() => validateSpawn({ x: NaN, z: 0 }), /Invalid/);
});

test('public town projection refuses malformed and oversized bounds', () => {
  const claim = { town: 'Probe Town', x1: 1, x2: 3, z1: -9, z2: -7 };
  assert.throws(() => validateClaims([{ ...claim, x2: 0 }]), /invalid/);
  assert.throws(() => validateClaims([{ ...claim, z2: 100 }]), /invalid/);
  assert.throws(() => validateClaims([{ ...claim, town: '<script>' }]), /invalid/);
  assert.throws(() => validateClaims(new Array(1025).fill(claim)), /invalid/);
});
