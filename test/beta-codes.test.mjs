import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBetaCodes } from '../server/beta-codes.mjs';

const admin = `0x${'a'.repeat(40)}`;
const alice = `0x${'b'.repeat(40)}`;
const bob = `0x${'c'.repeat(40)}`;

test('beta code is shown once, stored hashed, redeemed atomically and durable', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-beta-'));
  let clock = 1000;
  const first = createBetaCodes(dir, () => clock);
  const second = createBetaCodes(dir, () => clock);
  try {
    const created = first.create({ actor: admin, expiresAt: 2000 });
    assert.match(created.code, /^MM-[A-Za-z0-9_-]{32}$/);
    assert.equal(statSync(first.file).mode & 0o777, 0o600);
    assert.equal(readFileSync(first.file).includes(created.code), false, 'plaintext invite must not be stored');
    assert.equal(first.list()[0].id, created.id);
    assert.equal(first.list()[0].uses, 0);
    assert.equal(second.redeem(created.code, alice).alreadyAdmitted, false);
    assert.equal(first.redeem(created.code, alice).alreadyAdmitted, true);
    assert.equal(first.isAdmitted(alice), true);
    assert.equal(first.list()[0].uses, 1);
    assert.deepEqual(first.recentAudit().map(event => event.action), ['redeemed', 'created']);
    assert.throws(() => first.redeem(created.code, bob), { code: 'invalid_code' });
    first.close();
    const reopened = createBetaCodes(dir, () => clock);
    try { assert.equal(reopened.isAdmitted(alice), true); assert.equal(reopened.recentAudit()[0].actor, alice); }
    finally { reopened.close(); }
  } finally {
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('targeted invites reject other accounts and expiry or revocation blocks new redemption', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-beta-'));
  let clock = 1000;
  const codes = createBetaCodes(dir, () => clock);
  try {
    const targeted = codes.create({ actor: admin, intendedAccount: alice, expiresAt: 2000, maxUses: 2 });
    assert.throws(() => codes.redeem(targeted.code, bob), { code: 'invalid_code' });
    assert.equal(codes.redeem(targeted.code, alice).admitted, true);
    const expiring = codes.create({ actor: admin, expiresAt: 1500 });
    clock = 1500;
    assert.throws(() => codes.redeem(expiring.code, bob), { code: 'invalid_code' });
    const revoking = codes.create({ actor: admin, expiresAt: 2500 });
    assert.equal(codes.revoke(revoking.id, admin), true);
    assert.equal(codes.revoke(revoking.id, admin), false);
    assert.throws(() => codes.redeem(revoking.code, bob), { code: 'invalid_code' });
    assert.equal(codes.isAdmitted(alice), true, 'revocation does not erase an existing admission');
    assert.throws(() => codes.create({ actor: admin, expiresAt: clock + 1000, maxUses: 101 }), { code: 'invalid_input' });
  } finally {
    codes.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
