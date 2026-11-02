import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Wallet } from 'ethers';
import { createNameRegistry, normalizeHandle } from '../server/name-registry.mjs';
import { playerName } from '../server/auth.mjs';

test('normalization uses one case-insensitive, restricted MineMine namespace', () => {
  assert.equal(normalizeHandle('Alice9'), 'alice9');
  for (const value of [' alicia', 'a', 'alice-name', 'álîce', 'admin', 'A'.repeat(17)]) {
    assert.throws(() => normalizeHandle(value), { code: 'invalid_handle' });
  }
});

test('checkout holds block ENS and admin claims across connections and survive restart', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-names-'));
  let clock = 1000;
  const first = createNameRegistry(dir, () => clock);
  const second = createNameRegistry(dir, () => clock);
  try {
    const hold = first.beginCheckout('Alice', 'smart:alice', 'order-1');
    assert.equal(hold.handle, 'alice');
    assert.equal(hold.state, 'checkout_held');
    assert.deepEqual(first.beginCheckout('ALICE', 'smart:alice', 'order-1'), hold);
    assert.throws(() => second.beginCheckout('alice', 'smart:bob', 'order-2'), { code: 'unavailable' });
    assert.throws(() => second.claimVerifiedEns('alice', 'wallet:bob', 'alice.eth'), { code: 'unavailable' });
    assert.throws(() => second.reserveAdmin('alice', 'wallet:admin', null, clock + 1000), { code: 'unavailable' });
    clock += 60_000;
    assert.equal(second.lookup('alice').state, 'checkout_held', 'a timeout alone must not release a payable hold');
    assert.equal(first.markPaid('alice', 'smart:alice', 'order-1', 'payment-1').state, 'paid_pending_ens');
    assert.equal(second.markPaid('ALICE', 'smart:alice', 'order-1', 'payment-1').payment_id, 'payment-1');
    assert.throws(() => first.releaseCheckout('alice', 'smart:alice', 'order-1'), { code: 'conflict' });
    assert.throws(() => first.markPaid('alice', 'smart:alice', 'order-1', 'payment-2'), { code: 'conflict' });
    first.close();
    const reopened = createNameRegistry(dir, () => clock);
    try { assert.equal(reopened.lookup('alice').payment_id, 'payment-1'); }
    finally { reopened.close(); }
  } finally {
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin reservation can be claimed only by its intended account, after expiry by anyone', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-names-'));
  let clock = 1000;
  const registry = createNameRegistry(dir, () => clock);
  try {
    registry.reserveAdmin('Builder', 'wallet:admin', 'wallet:builder', 2000);
    assert.throws(() => registry.claimVerifiedEns('builder', 'wallet:other', 'builder.eth'), { code: 'unavailable' });
    assert.equal(registry.claimVerifiedEns('BUILDER', 'wallet:builder', 'Bücher.eth').ens_name, 'bücher.eth');
    assert.throws(() => registry.beginCheckout('othername', 'wallet:builder', 'order-2'), { code: 'account_has_name' });
    registry.reserveAdmin('Miner', 'wallet:admin', null, 2000);
    assert.throws(() => registry.beginCheckout('miner', 'smart:miner', 'order-3'), { code: 'unavailable' });
    clock = 2000;
    assert.equal(registry.lookup('miner'), null);
    assert.equal(registry.beginCheckout('Miner', 'smart:miner', 'order-3').state, 'checkout_held');
  } finally {
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only an unpaid matching checkout can be explicitly released', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-names-'));
  const registry = createNameRegistry(dir);
  try {
    registry.beginCheckout('captain', 'smart:a', 'order-a');
    assert.throws(() => registry.releaseCheckout('captain', 'smart:b', 'order-a'), { code: 'conflict' });
    assert.throws(() => registry.releaseCheckout('captain', 'smart:a', 'order-b'), { code: 'conflict' });
    assert.equal(registry.releaseCheckout('captain', 'smart:a', 'order-a'), true);
    assert.deepEqual(registry.recentAudit().map(event => event.action), ['checkout_released', 'checkout_held']);
    assert.equal(registry.lookup('captain'), null);
    assert.equal(registry.beginCheckout('captain', 'smart:b', 'order-b').account_id, 'smart:b');
    assert.throws(() => registry.markPaid('captain', 'smart:a', 'order-a', 'payment-late'), { code: 'conflict' });
  } finally {
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verified full ENS selection is durable, unique, and can follow an onchain transfer', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-ens-selection-'));
  const first = createNameRegistry(dir);
  const second = createNameRegistry(dir);
  try {
    first.reserveAdmin('alice', 'wallet:admin', null, Date.now() + 60_000);
    assert.equal(first.selectEns('wallet:alice', 'Bücher.eth'), 'bücher.eth');
    assert.equal(second.selectedEns('wallet:alice'), 'bücher.eth');
    assert.equal(first.selectEns('wallet:alice', 'Bücher.eth'), 'bücher.eth');
    assert.equal(second.selectEns('wallet:bob', 'bücher.eth'), 'bücher.eth');
    assert.equal(first.selectedEns('wallet:alice'), null, 'a new verified owner displaces a stale selection');
    assert.equal(second.selectedEns('wallet:bob'), 'bücher.eth');
    assert.equal(second.clearSelectedEns('wallet:bob', 'other.eth'), false);
    assert.equal(first.clearSelectedEns('wallet:bob', 'bücher.eth'), true);
    assert.equal(second.selectedEns('wallet:bob'), null);
    assert.equal(first.lookup('alice').state, 'admin_reserved', 'a paid or reserved bare handle is independent of a full ENS name');
    assert.deepEqual(first.recentAudit().filter(event => event.action.startsWith('ens_')).map(event => event.action), ['ens_cleared', 'ens_selected', 'ens_reassigned', 'ens_selected']);
    assert.throws(() => first.selectEns('wallet:alice', 'bad name.eth'), { code: 'invalid_input' });
  } finally {
    first.close(); second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a verified MineMine subname and a reserved handle cannot belong to different accounts', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-namespace-'));
  const first = createNameRegistry(dir);
  const second = createNameRegistry(dir);
  try {
    first.reserveAdmin('alice', 'wallet:admin', 'wallet:alice', Date.now() + 60_000);
    assert.equal(first.ensNameAllowed('wallet:bob', 'alice.minemine.eth'), false);
    assert.equal(first.ensNameAllowed('wallet:bob', 'Alice.MineMine.ETH'), false, 'reverse-name case cannot bypass the reservation');
    assert.throws(() => second.selectEns('wallet:bob', 'alice.minemine.eth'), { code: 'unavailable' });
    assert.equal(second.selectEns('wallet:alice', 'alice.minemine.eth'), 'alice.minemine.eth');
    assert.equal(first.ensNameAllowed('wallet:bob', 'bob.minemine.eth'), true);
    assert.equal(first.ensNameAllowed('wallet:bob', 'admin.minemine.eth'), false);
    assert.equal(first.ensNameAllowed('wallet:bob', 'alice.eth'), true);
    first.releaseAdmin('alice', 'wallet:admin');
    assert.throws(() => second.beginCheckout('Alice', 'smart:buyer', 'order-1'), { code: 'unavailable' });
    assert.throws(() => second.reserveAdmin('ALICE', 'wallet:admin', null, Date.now() + 60_000), { code: 'unavailable' });
    assert.throws(() => second.claimVerifiedEns('alice', 'wallet:bob', 'alice.minemine.eth'), { code: 'unavailable' });
    first.clearSelectedEns('wallet:alice');
    assert.equal(second.beginCheckout('alice', 'smart:buyer', 'order-1').state, 'checkout_held');
    assert.throws(() => first.selectEns('wallet:alice', 'alice.minemine.eth'), { code: 'unavailable' });
    assert.equal(first.selectEns('wallet:alice', 'other.eth'), 'other.eth', 'other ENS namespaces remain independent');
  } finally {
    first.close(); second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('signed wallet profile binds one stable character across logins and registry restart', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-wallet-profile-'));
  let clock = Date.parse('2026-11-01T12:00:00Z');
  const wallet = new Wallet('0x' + 'ab'.repeat(32));
  const name = playerName(wallet.address);
  const first = createNameRegistry(dir, () => clock);
  try {
    const profile = first.recordWalletSignIn({ address: wallet.address, playerName: name });
    assert.equal(profile.address, wallet.address.toLowerCase());
    assert.equal(profile.firstSignedInAt, '2026-11-01T12:00:00.000Z');
    clock += 60_000;
    first.recordWalletSignIn({ address: wallet.address.toLowerCase(), playerName: name });
    assert.equal(first.walletProfile(name).lastSignedInAt, '2026-11-01T12:01:00.000Z');
    assert.throws(() => first.recordWalletSignIn({ address: wallet.address, playerName: `w_${'f'.repeat(17)}` }), { code: 'conflict' });
    assert.throws(() => first.recordWalletSignIn({ address: 'invalid', playerName: name }), { code: 'invalid_input' });
    first.close();
    const reopened = createNameRegistry(dir, () => clock);
    try { assert.equal(reopened.walletProfile(name).firstSignedInAt, '2026-11-01T12:00:00.000Z'); }
    finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legacy paid records migrate and activate only after a matching ENS address readback', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-paid-name-'));
  const wallet = new Wallet('0x' + 'c4'.repeat(32));
  const accountId = wallet.address.toLowerCase();
  const registryDir = path.join(dir, 'name_registry');
  mkdirSync(registryDir);
  const old = new DatabaseSync(path.join(registryDir, 'registry.sqlite'));
  old.exec(`CREATE TABLE names (
    handle TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('admin_reserved', 'checkout_held', 'paid_pending_ens', 'wallet_claimed')),
    account_id TEXT, intended_account_id TEXT, order_id TEXT UNIQUE, payment_id TEXT UNIQUE,
    ens_name TEXT, expires_at INTEGER, updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX names_account_unique ON names(account_id) WHERE account_id IS NOT NULL;
  CREATE TABLE name_audit (id INTEGER PRIMARY KEY, handle TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL);`);
  old.prepare("INSERT INTO names VALUES ('builder', 'paid_pending_ens', ?, NULL, 'order-1', 'payment-1', NULL, NULL, 1000)").run(accountId);
  old.prepare("INSERT INTO name_audit VALUES (1, 'builder', 'paid_pending_ens', ?, 1000)").run(accountId);
  old.close();
  const names = createNameRegistry(dir);
  try {
    assert.equal(names.lookup('builder').state, 'paid_pending_ens');
    assert.equal(names.managedNameForAccount(accountId), null);
    await assert.rejects(names.activateManagedName('builder', accountId, 'order-1', 'payment-1', async () => null), { code: 'ens_unverified' });
    await assert.rejects(names.activateManagedName('builder', accountId, 'order-1', 'payment-1', async () => Wallet.createRandom().address), { code: 'ens_unverified' });
    await assert.rejects(names.activateManagedName('builder', accountId, 'order-1', 'other-payment', async () => wallet.address), { code: 'conflict' });
    const resolve = async name => {
      assert.equal(name, 'builder.minemine.eth');
      return wallet.address;
    };
    const active = await names.activateManagedName('BUILDER', accountId, 'order-1', 'payment-1', resolve);
    assert.equal(active.state, 'paid_active');
    assert.equal(active.ens_name, 'builder.minemine.eth');
    assert.equal(names.managedNameForAccount(accountId), 'builder.minemine.eth');
    assert.equal(names.markPaid('builder', accountId, 'order-1', 'payment-1').state, 'paid_active', 'webhook replay cannot demote the name');
    assert.equal((await names.activateManagedName('builder', accountId, 'order-1', 'payment-1', resolve)).state, 'paid_active');
    assert.deepEqual(names.recentAudit().map(event => event.action), ['paid_active', 'paid_pending_ens']);
  } finally { names.close(); }
  const reopened = createNameRegistry(dir);
  try { assert.equal(reopened.managedNameForAccount(accountId), 'builder.minemine.eth'); }
  finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('public-name lookup exposes only active managed names or selected full ENS names', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-public-name-'));
  const wallet = new Wallet('0x' + 'f4'.repeat(32));
  const accountId = wallet.address.toLowerCase();
  const names = createNameRegistry(dir);
  try {
    names.beginCheckout('builder', accountId, 'order-1');
    names.markPaid('builder', accountId, 'order-1', 'payment-1');
    assert.deepEqual(names.managedNameTermForAccount(accountId), { name: 'builder.minemine.eth', status: 'pending', expiresAt: null });
    assert.equal(names.managedNameTermForAccount(Wallet.createRandom().address.toLowerCase()), null);
    assert.equal(names.accountForPublicName('builder'), null);
    assert.equal(names.accountForPublicName('builder.minemine.eth'), null);
    names.selectEns(accountId, 'Other.eth');
    assert.equal(names.accountForPublicName('OTHER.ETH'), accountId);
    await names.activateManagedName('builder', accountId, 'order-1', 'payment-1', async () => wallet.address);
    assert.equal(names.accountForPublicName('BUILDER'), accountId);
    assert.equal(names.accountForPublicName('Builder.MineMine.ETH'), accountId);
    assert.equal(names.accountForPublicName('missing'), null);
    assert.throws(() => names.accountForPublicName('bad name.eth'), { code: 'invalid_input' });
  } finally { names.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('managed name lasts one calendar year from verified activation and then stops resolving publicly', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-managed-term-'));
  const wallet = new Wallet('0x' + 'd4'.repeat(32));
  const accountId = wallet.address.toLowerCase();
  let clock = Date.UTC(2024, 1, 28, 12, 30);
  const names = createNameRegistry(dir, () => clock);
  try {
    names.beginCheckout('builder', accountId, 'order-1');
    names.markPaid('builder', accountId, 'order-1', 'payment-1');
    clock += 86_400_000;
    const active = await names.activateManagedName('builder', accountId, 'order-1', 'payment-1', async () => wallet.address);
    const expiresAt = Date.UTC(2025, 1, 28, 12, 30);
    assert.equal(active.expires_at, expiresAt);
    assert.deepEqual(names.managedNameTermForAccount(accountId), { name: 'builder.minemine.eth', status: 'active', expiresAt: new Date(expiresAt).toISOString() });
    names.selectEns(accountId, 'builder.minemine.eth');
    assert.equal(names.managedNameForAccount(accountId), 'builder.minemine.eth');
    assert.equal(names.accountForPublicName('builder'), accountId);
    assert.equal(names.accountForPublicName('builder.minemine.eth'), accountId);
    clock = expiresAt;
    assert.deepEqual(names.managedNameTermForAccount(accountId), { name: 'builder.minemine.eth', status: 'expired', expiresAt: new Date(expiresAt).toISOString() });
    assert.equal(names.managedNameForAccount(accountId), null);
    assert.equal(names.accountForPublicName('builder'), null);
    assert.equal(names.accountForPublicName('builder.minemine.eth'), null, 'selected alias cannot bypass paid term');
    assert.equal(names.ensNameAllowed(accountId, 'builder.minemine.eth'), false);
    assert.equal(names.lookup('builder').state, 'paid_active', 'expired name remains reserved until safe onchain cleanup');
    assert.throws(() => names.beginCheckout('builder', Wallet.createRandom().address.toLowerCase(), 'order-2'), { code: 'unavailable' });
    assert.equal((await names.activateManagedName('builder', accountId, 'order-1', 'payment-1', async () => wallet.address)).expires_at, expiresAt,
      'activation retry cannot extend the term');
  } finally { names.close(); rmSync(dir, { recursive: true, force: true }); }
});
