import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import Stripe from 'stripe';
import { createNameRegistry } from '../server/name-registry.mjs';
import { createNameCheckout } from '../server/name-checkout.mjs';

const secret = 'whsec_minemine_test';
const orderId = 'order_1234567890123456';
const sessionId = 'cs_test_minemine_name_1';
const sdk = new Stripe('sk_test_minemine_test');

function signedEvent(type, id = sessionId) {
  const payload = JSON.stringify({ id: 'evt_test_1', object: 'event', livemode: false, type,
    data: { object: { id } } });
  return { payload, signature: sdk.webhooks.generateTestHeaderString({ payload, secret }) };
}

function fixture(t) {
  const world = mkdtempSync(path.join(os.tmpdir(), 'minemine-checkout-'));
  let now = Date.parse('2026-11-02T17:00:00Z');
  const names = createNameRegistry(world, () => now);
  t.after(() => { names.close(); rmSync(world, { recursive: true, force: true }); });
  const wallet = new Wallet('0x' + 'a4'.repeat(32));
  const accountId = wallet.address.toLowerCase();
  let session;
  let createCalls = 0;
  let failNextCreate = false;
  const createParams = [];
  let preflightError = null;
  const checkedHandles = [];
  const stripe = {
    webhooks: sdk.webhooks,
    checkout: { sessions: {
      async create(params, options) {
        createCalls++;
        createParams.push(params);
        assert.equal(params.line_items[0].price_data.unit_amount, 200);
        assert.equal(params.line_items[0].price_data.currency, 'usd');
        assert.equal(params.line_items[0].price_data.product_data.name,
          'MineMine account and first year of builder.minemine.eth');
        assert.equal(params.success_url, 'https://play.example/account/?name_checkout=success');
        assert.equal(params.cancel_url, 'https://play.example/account/?name_checkout=cancelled');
        assert.deepEqual(params.payment_method_types, ['card']);
        assert.equal(params.metadata.account_id, accountId);
        assert.equal(params.metadata.handle, 'builder');
        assert.equal(params.client_reference_id, orderId);
        assert.equal(options.idempotencyKey, `minemine-name-${orderId}`);
        if (failNextCreate) { failNextCreate = false; throw new Error('Uncertain Stripe API result.'); }
        session = { id: sessionId, object: 'checkout.session', livemode: false, mode: 'payment',
          currency: 'usd', amount_total: 200, payment_status: 'unpaid', status: 'open',
          client_reference_id: orderId, metadata: params.metadata, expires_at: params.expires_at,
          url: `https://checkout.stripe.com/c/pay/${sessionId}` };
        return session;
      },
      async retrieve(id) {
        assert.equal(id, sessionId);
        return session;
      },
    } },
  };
  const checkout = createNameCheckout({ stripe, names, origin: 'https://play.example', webhookSecret: secret,
    preflight: async handle => { checkedHandles.push(handle); if (preflightError) throw preflightError; },
  });
  return { checkout, stripe, names, accountId, setSession: value => { session = value; },
    getSession: () => session, getCreateCalls: () => createCalls, createParams,
    advance: milliseconds => { now += milliseconds; },
    failNextCreate: () => { failNextCreate = true; }, checkedHandles,
    failPreflight: error => { preflightError = error; } };
}

test('server-priced test checkout fulfills once from a signed, retrieved paid session', async t => {
  const { checkout, names, accountId, getSession, setSession, getCreateCalls } = fixture(t);
  await assert.rejects(checkout.create({ handle: 'builder', accountId: 'smart:builder', orderId }), { code: 'invalid_input' });
  const created = await checkout.create({ handle: 'BUILDER', accountId, orderId });
  assert.equal(created.url, `https://checkout.stripe.com/c/pay/${sessionId}`);
  assert.equal(created.expiresAt, '2026-11-02T17:45:00.000Z');
  assert.equal(names.lookup('builder').state, 'checkout_held');
  await assert.rejects(checkout.create({ handle: 'builder', accountId: new Wallet('0x' + 'b4'.repeat(32)).address.toLowerCase(), orderId: 'other_1234567890123456' }), { code: 'unavailable' });
  assert.equal(getCreateCalls(), 1, 'a collision never reaches Stripe');
  const event = signedEvent('checkout.session.completed');
  await assert.rejects(checkout.handleWebhook(event.payload, 't=1,v1=deadbeef'), /signature/i);
  await assert.rejects(checkout.handleWebhook(event.payload, event.signature), /not a paid/);
  assert.equal(names.lookup('builder').state, 'checkout_held');
  const paid = { ...getSession(), status: 'complete', payment_status: 'paid',
    line_items: { has_more: false, data: [{ amount_total: 200, currency: 'usd', quantity: 1 }] } };
  setSession({ ...paid, amount_total: 201 });
  await assert.rejects(checkout.handleWebhook(event.payload, event.signature), /does not match/);
  setSession(paid);
  assert.deepEqual(await checkout.handleWebhook(event.payload, event.signature), { received: true });
  assert.equal(names.lookup('builder').state, 'paid_pending_ens');
  assert.equal(names.lookup('builder').payment_id, sessionId);
  await checkout.handleWebhook(event.payload, event.signature);
  assert.deepEqual(names.recentAudit().map(row => row.action), ['paid_pending_ens', 'checkout_held']);
  assert.equal(names.managedNameForAccount(accountId), null, 'payment is not ENS issuance');
});

test('ENS preflight blocks the checkout before creating a local hold or Stripe session', async t => {
  const { checkout, stripe, names, accountId, getCreateCalls, checkedHandles, failPreflight } = fixture(t);
  const unconfigured = createNameCheckout({ stripe, names, origin: 'https://play.example', webhookSecret: secret });
  await assert.rejects(unconfigured.create({ handle: 'builder', accountId, orderId }), { code: 'ens_sale_unavailable' });
  failPreflight(new Error('Parent resolver is not configured.'));
  await assert.rejects(checkout.create({ handle: 'BUILDER', accountId, orderId }), /Parent resolver/);
  assert.deepEqual(checkedHandles, ['builder']);
  assert.equal(names.lookup('builder'), null);
  assert.equal(getCreateCalls(), 0);
});

test('only a verified expired and unpaid test session releases a checkout hold', async t => {
  const { checkout, names, accountId, getSession, setSession } = fixture(t);
  await checkout.create({ handle: 'builder', accountId, orderId });
  const expired = signedEvent('checkout.session.expired');
  await assert.rejects(checkout.handleWebhook(expired.payload, expired.signature), /not terminal/);
  assert.equal(names.lookup('builder').state, 'checkout_held');
  setSession({ ...getSession(), status: 'expired' });
  await checkout.handleWebhook(expired.payload, expired.signature);
  assert.equal(names.lookup('builder'), null);
  const paid = signedEvent('checkout.session.completed');
  setSession({ ...getSession(), status: 'complete', payment_status: 'paid',
    line_items: { has_more: false, data: [{ amount_total: 200, currency: 'usd', quantity: 1 }] } });
  await assert.rejects(checkout.handleWebhook(paid.payload, paid.signature), { code: 'conflict' });
});

test('an uncertain Stripe create result retains stable parameters for an idempotent retry', async t => {
  const { checkout, names, accountId, failNextCreate, getCreateCalls, createParams, advance } = fixture(t);
  failNextCreate();
  await assert.rejects(checkout.create({ handle: 'builder', accountId, orderId }), /Uncertain/);
  assert.equal(names.lookup('builder').state, 'checkout_held');
  advance(60_000);
  await checkout.create({ handle: 'builder', accountId, orderId });
  assert.equal(getCreateCalls(), 2);
  assert.deepEqual(createParams[1], createParams[0], 'Stripe requires identical retry parameters');
  assert.equal(names.lookup('builder').order_id, orderId);
  const liveEvent = { id: 'evt_live', object: 'event', livemode: true, type: 'checkout.session.completed',
    data: { object: { id: sessionId } } };
  const payload = JSON.stringify(liveEvent);
  const signature = sdk.webhooks.generateTestHeaderString({ payload, secret });
  await assert.rejects(checkout.handleWebhook(payload, signature), /test-mode/);
  assert.equal(names.lookup('builder').state, 'checkout_held');
});
