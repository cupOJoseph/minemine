import { getAddress } from 'ethers';
import { NameRegistryError, normalizeHandle } from './name-registry.mjs';

const PRICE_CENTS = 200;

function accountAddress(value) {
  try {
    const address = getAddress(value).toLowerCase();
    if (address === value) return address;
  } catch { /* Reject non-wallet and noncanonical account IDs. */ }
  throw new NameRegistryError('A signed account wallet is required for name checkout.', 'invalid_input');
}

function validateSession(session, expectedId = null) {
  if (!session || session.object !== 'checkout.session' || session.livemode !== false ||
      typeof session.id !== 'string' || !session.id.startsWith('cs_test_') ||
      (expectedId && session.id !== expectedId) || session.mode !== 'payment' ||
      session.currency !== 'usd' || session.amount_total !== PRICE_CENTS ||
      typeof session.client_reference_id !== 'string' ||
      session.metadata?.order_id !== session.client_reference_id ||
      session.metadata?.handle !== normalizeHandle(session.metadata?.handle) ||
      session.metadata?.account_id !== accountAddress(session.metadata?.account_id)) {
    throw new Error('Stripe test session does not match the MineMine name purchase.');
  }
  return { handle: session.metadata.handle, accountId: session.metadata.account_id,
    orderId: session.client_reference_id };
}

// The signed-player route exposes this only in a loopback Stripe test lab.
// A production signup still needs proof that this wallet came from ZeroDev.
export function createNameCheckout({ stripe, names, origin, webhookSecret, preflight }) {
  if (!stripe?.checkout?.sessions || !stripe?.webhooks || !webhookSecret?.startsWith('whsec_')) {
    throw new Error('Stripe test checkout is not configured.');
  }
  return {
    async create({ handle, accountId, orderId }) {
      handle = normalizeHandle(handle);
      accountId = accountAddress(accountId);
      if (typeof orderId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(orderId)) {
        throw new NameRegistryError('Invalid checkout order ID.', 'invalid_input');
      }
      if (typeof preflight !== 'function') throw new NameRegistryError('Managed ENS sale is not configured.', 'ens_sale_unavailable');
      await preflight(handle);
      const hold = names.beginCheckout(handle, accountId, orderId);
      // Retry with the same order ID after an uncertain API result. Never free a
      // hold solely because a network call failed: a Checkout Session may exist.
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{ price_data: { currency: 'usd', unit_amount: PRICE_CENTS,
          product_data: { name: `MineMine account and first year of ${handle}.minemine.eth` } }, quantity: 1 }],
        client_reference_id: orderId,
        metadata: { order_id: orderId, account_id: accountId, handle },
        success_url: `${origin}/?name_checkout=success`,
        cancel_url: `${origin}/?name_checkout=cancelled`,
        // Stripe compares every parameter on an idempotent retry. Keep this
        // timestamp tied to the durable hold, even across a server restart.
        expires_at: Math.floor(hold.updated_at / 1000) + 45 * 60,
      }, { idempotencyKey: `minemine-name-${orderId}` });
      validateSession(session);
      if (session.client_reference_id !== orderId || session.metadata.handle !== handle ||
          session.metadata.account_id !== accountId || session.status !== 'open' ||
          !session.url || new URL(session.url).protocol !== 'https:' ||
          new URL(session.url).hostname !== 'checkout.stripe.com') {
        throw new Error('Stripe returned an unexpected test Checkout Session.');
      }
      return { orderId, handle, url: session.url, expiresAt: new Date(session.expires_at * 1000).toISOString() };
    },
    async fulfill(sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
      const { handle, accountId, orderId } = validateSession(session, sessionId);
      if (session.status !== 'complete' || session.payment_status !== 'paid' ||
          session.line_items?.has_more || session.line_items?.data?.length !== 1 ||
          session.line_items.data[0]?.amount_total !== PRICE_CENTS ||
          session.line_items.data[0]?.currency !== 'usd' ||
          session.line_items.data[0]?.quantity !== 1) {
        throw new Error('Stripe test Checkout Session is not a paid $2 name purchase.');
      }
      return names.markPaid(handle, accountId, orderId, session.id);
    },
    async expire(sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const { handle, accountId, orderId } = validateSession(session, sessionId);
      if (session.status !== 'expired' || session.payment_status !== 'unpaid') {
        throw new Error('Stripe test Checkout Session is not terminal and unpaid.');
      }
      return names.releaseCheckout(handle, accountId, orderId);
    },
    async handleWebhook(rawBody, signature) {
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      if (event?.livemode !== false) throw new Error('Only Stripe test-mode events are accepted.');
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired'].includes(event.type)) {
        const sessionId = event.data?.object?.id;
        if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_test_')) throw new Error('Invalid Stripe test session ID.');
        if (event.type === 'checkout.session.expired') await this.expire(sessionId);
        else await this.fulfill(sessionId);
      }
      return { received: true };
    },
  };
}
