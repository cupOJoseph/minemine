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

test('profile projection backfills and acknowledges only the durable source revision', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-profile-outbox-'));
  const wallet = new Wallet('0x' + 'ae'.repeat(32));
  const name = playerName(wallet.address);
  const accountId = wallet.address.toLowerCase();
  const first = createNameRegistry(dir);
  try {
    first.recordWalletSignIn({ address: wallet.address, playerName: name });
    first.recordWalletSignIn({ address: wallet.address, playerName: name });
    assert.equal(first.pendingProfileProjectionCount(), 1);
    assert.deepEqual(first.pendingProfileProjections(), [{ accountId, playerId: name, displayName: name, revision: 1 }]);
    assert.equal(first.acknowledgeProfileProjection(accountId, 2), false);
    assert.deepEqual(first.pendingProfileProjections(), [{ accountId, playerId: name, displayName: name, revision: 1 }]);
    first.close();
    const second = createNameRegistry(dir);
    try {
      assert.equal(second.acknowledgeProfileProjection(accountId, 1), true);
      assert.equal(second.acknowledgeProfileProjection(accountId, 1), false);
      assert.deepEqual(second.pendingProfileProjections(), []);
      assert.equal(second.pendingProfileProjectionCount(), 0);
      assert.throws(() => second.pendingProfileProjections(0), { code: 'invalid_input' });
      assert.throws(() => second.acknowledgeProfileProjection('invalid', 1), { code: 'invalid_input' });
      second.close();
    } finally { /* The database was closed above. */ }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('profile projection backfills a wallet profile created by an older world', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-profile-backfill-'));
  const wallet = new Wallet('0x' + 'af'.repeat(32));
  const name = playerName(wallet.address);
  const first = createNameRegistry(dir);
  try { first.close(); }
  finally {
    const db = new DatabaseSync(path.join(dir, 'name_registry', 'registry.sqlite'));
    db.prepare('INSERT INTO wallet_profiles VALUES (?, ?, 1000, 1000)').run(name, wallet.address.toLowerCase());
    db.close();
  }
  const second = createNameRegistry(dir);
  try { assert.deepEqual(second.pendingProfileProjections(), [{ accountId: wallet.address.toLowerCase(), playerId: name, displayName: name, revision: 1 }]); }
  finally { second.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('verified ENS display changes advance the durable profile revision without moving the native ID', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-profile-display-'));
  const wallet = new Wallet('0x' + 'bc'.repeat(32));
  const accountId = wallet.address.toLowerCase();
  const playerId = playerName(wallet.address);
  const names = createNameRegistry(dir);
  try {
    assert.equal(names.recordVerifiedProfileDisplay(accountId, playerId, 'builder.eth'), false,
      'a profile cannot be projected before its signed wallet has a native binding');
    names.recordWalletSignIn({ address: wallet.address, playerName: playerId });
    assert.equal(names.recordVerifiedProfileDisplay(accountId, playerId, 'builder.eth'), 2);
    assert.equal(names.recordVerifiedProfileDisplay(accountId, playerId, 'builder.eth'), 2,
      'the same verified display is idempotent');
    assert.deepEqual(names.pendingProfileProjections(), [
      { accountId, playerId, displayName: 'builder.eth', revision: 2 },
    ]);
    assert.equal(names.acknowledgeProfileProjection(accountId, 1), false,
      'an old acknowledgement cannot clear a newer name');
    const longEns = `${'a'.repeat(63)}.${'b'.repeat(63)}.eth`;
    assert.equal(names.recordVerifiedProfileDisplay(accountId, playerId, longEns), 3,
      'a valid ENS name longer than the old 64-character limit remains intact');
    assert.equal(names.recordVerifiedProfileDisplay(accountId, playerId, playerId), 4,
      'lost ownership falls back to the stable native ID');
    assert.equal(names.acknowledgeProfileProjection(accountId, 2), false);
    assert.throws(() => names.recordVerifiedProfileDisplay(accountId, 'w_00000000000000000', 'builder.eth'),
      { code: 'invalid_input' });
    assert.throws(() => names.recordVerifiedProfileDisplay(accountId, playerId, 'bad name'),
      { code: 'invalid_input' });
    assert.throws(() => names.recordVerifiedProfileDisplay(accountId, playerId, 'a'.repeat(256) + '.eth'),
      { code: 'invalid_input' });
    assert.deepEqual(names.pendingProfileProjections(), [
      { accountId, playerId, displayName: playerId, revision: 4 },
    ]);
    assert.equal(names.acknowledgeProfileProjection(accountId, 4), true);
  } finally { names.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('acknowledged ENS displays are rechecked in oldest-first bounded batches with revision-safe fallback', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-profile-recheck-'));
  let clock = Date.parse('2026-11-05T12:00:00Z');
  const names = createNameRegistry(dir, () => clock);
  try {
    const wallets = ['d1', 'd2'].map(seed => new Wallet(`0x${seed.repeat(32)}`));
    const accounts = wallets.map(wallet => wallet.address.toLowerCase());
    const players = wallets.map(wallet => playerName(wallet.address));
    for (let index = 0; index < 2; index++) {
      names.recordWalletSignIn({ address: wallets[index].address, playerName: players[index] });
      assert.equal(names.recordVerifiedProfileDisplay(accounts[index], players[index], `builder${index}.eth`), 2);
      assert.equal(names.acknowledgeProfileProjection(accounts[index], 2), true);
    }
    const due = names.profilesDueForDisplayRecheck();
    assert.equal(due.length, 2);
    assert.equal(names.completeProfileDisplayRecheck(due[0], true), true);
    assert.deepEqual(names.profilesDueForDisplayRecheck().map(row => row.accountId), [due[1].accountId]);
    assert.equal(names.completeProfileDisplayRecheck(due[1], false), true);
    assert.deepEqual(names.pendingProfileProjections(), [{
      accountId: due[1].accountId, playerId: due[1].playerId,
      displayName: due[1].playerId, revision: 3,
    }]);
    assert.equal(names.completeProfileDisplayRecheck(due[1], false), false,
      'a stale ownership result cannot advance the revision twice');
    clock += 120_000;
    assert.deepEqual(names.profilesDueForDisplayRecheck().map(row => row.accountId), [due[0].accountId]);
    names.recordVerifiedProfileDisplay(due[0].accountId, due[0].playerId, 'newbuilder.eth');
    assert.equal(names.completeProfileDisplayRecheck(due[0], false), false,
      'an old failed lookup cannot replace a newer verified display');
    assert.equal(names.profilesDueForDisplayRecheck().length, 0,
      'unacknowledged names are checked during projection instead');
    assert.throws(() => names.profilesDueForDisplayRecheck(0), { code: 'invalid_input' });
  } finally { names.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('older profile databases add the durable recheck column on open', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-profile-recheck-migrate-'));
  const wallet = new Wallet('0x' + 'e1'.repeat(32));
  const accountId = wallet.address.toLowerCase();
  const playerId = playerName(wallet.address);
  const first = createNameRegistry(dir);
  first.recordWalletSignIn({ address: wallet.address, playerName: playerId });
  first.recordVerifiedProfileDisplay(accountId, playerId, 'legacy.eth');
  first.acknowledgeProfileProjection(accountId, 2);
  first.close();
  const db = new DatabaseSync(path.join(dir, 'name_registry', 'registry.sqlite'));
  db.exec(`ALTER TABLE profile_projection DROP COLUMN checked_at`);
  db.close();
  const reopened = createNameRegistry(dir);
  try {
    assert.deepEqual(reopened.profilesDueForDisplayRecheck().map(row => row.displayName), ['legacy.eth']);
  } finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
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
    const hold = names.beginCheckout('builder', accountId, 'order-1');
    assert.deepEqual(names.managedNameTermForAccount(accountId), {
      name: 'builder.minemine.eth', status: 'held', expiresAt: null,
      checkoutEndsAt: new Date(hold.updated_at + 45 * 60_000).toISOString(),
    });
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
