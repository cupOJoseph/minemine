import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNameRegistry, normalizeHandle } from '../server/name-registry.mjs';

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
