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
    assert.equal(registry.lookup('captain'), null);
    assert.equal(registry.beginCheckout('captain', 'smart:b', 'order-b').account_id, 'smart:b');
    assert.throws(() => registry.markPaid('captain', 'smart:a', 'order-a', 'payment-late'), { code: 'conflict' });
  } finally {
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
