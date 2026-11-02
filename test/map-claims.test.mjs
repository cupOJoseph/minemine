import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClaims } from '../public/map/claims.mjs';

test('public town projection accepts signed claim bounds without private account fields', () => {
  const claim = { town: 'Probe Town', x1: -3, x2: -1, z1: 7, z2: 9 };
  assert.deepEqual(validateClaims([claim]), [claim]);
  assert.throws(() => validateClaims([{ ...claim, owner: 'w_private' }]), /invalid/);
  assert.throws(() => validateClaims([{ ...claim, wallet: '0x1234' }]), /invalid/);
});

test('public town projection refuses malformed and oversized bounds', () => {
  const claim = { town: 'Probe Town', x1: 1, x2: 3, z1: -9, z2: -7 };
  assert.throws(() => validateClaims([{ ...claim, x2: 0 }]), /invalid/);
  assert.throws(() => validateClaims([{ ...claim, z2: 100 }]), /invalid/);
  assert.throws(() => validateClaims([{ ...claim, town: '<script>' }]), /invalid/);
  assert.throws(() => validateClaims(new Array(1025).fill(claim)), /invalid/);
});
