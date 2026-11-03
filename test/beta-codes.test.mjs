import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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

test('admission suspension survives restart and cannot be bypassed with another code', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-beta-'));
  let clock = 1000;
  let codes = createBetaCodes(dir, () => clock);
  try {
    const first = codes.create({ actor: admin, expiresAt: 3000 });
    const spare = codes.create({ actor: admin, expiresAt: 3000 });
    codes.redeem(first.code, alice);
    clock = 1100;
    assert.equal(codes.revokeAdmission(alice, admin), true);
    assert.equal(codes.revokeAdmission(alice, admin), false);
    assert.equal(codes.isAdmitted(alice), false);
    assert.equal(codes.admission(alice).revoked_at, clock);
    assert.throws(() => codes.redeem(spare.code, alice), { code: 'revoked' });
    assert.equal(codes.list().find(row => row.id === spare.id).uses, 0);
    codes.close();
    codes = createBetaCodes(dir, () => clock);
    assert.equal(codes.isAdmitted(alice), false);
    assert.equal(codes.restoreAdmission(alice, admin), true);
    assert.equal(codes.restoreAdmission(alice, admin), false);
    assert.equal(codes.isAdmitted(alice), true);
    assert.deepEqual(codes.recentAudit().slice(0, 2).map(event => [event.action, event.account_id]), [
      ['admission_restored', alice], ['admission_revoked', alice],
    ]);
    assert.throws(() => codes.revokeAdmission(bob, admin), { code: 'not_found' });
  } finally {
    codes.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('existing beta databases gain admission and audit fields without losing players', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-beta-'));
  const initial = createBetaCodes(dir, () => 1000);
  const created = initial.create({ actor: admin, expiresAt: 3000 });
  initial.redeem(created.code, alice);
  const file = initial.file;
  initial.close();
  const legacy = new DatabaseSync(file);
  legacy.exec(`ALTER TABLE beta_admissions DROP COLUMN revoked_at;
    ALTER TABLE beta_audit DROP COLUMN account_id;`);
  legacy.close();
  try {
    const upgraded = createBetaCodes(dir, () => 1100);
    try {
      assert.equal(upgraded.isAdmitted(alice), true);
      assert.equal(upgraded.revokeAdmission(alice, admin), true);
      assert.equal(upgraded.isAdmitted(alice), false);
    } finally { upgraded.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
