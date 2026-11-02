import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { chromium } from 'playwright';
import { createApp } from '../../server/app.mjs';
import { readConfig } from '../../server/config.mjs';
import { createNameRegistry } from '../../server/name-registry.mjs';

const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const worldDir = mkdtempSync(path.join(tmpdir(), 'minemine-name-term-ui-'));
const wallet = new Wallet('0x' + 'd1'.repeat(32));
const other = new Wallet('0x' + 'd2'.repeat(32));
let now = Date.UTC(2026, 10, 2, 12);
let target = wallet.address;
const names = createNameRegistry(worldDir, () => now);
const accountId = wallet.address.toLowerCase();
names.beginCheckout('builder', accountId, 'order-1');
names.markPaid('builder', accountId, 'order-1', 'payment-1');
const config = readConfig({ PUBLIC_ORIGIN: origin, PORT: String(port), CHAIN_ID: '31337', WORLD_DIR: worldDir });
config.now = () => now;
config.ensResolver = {
  async name() { return null; },
  async recipient(name) {
    assert.equal(name, 'builder.minemine.eth');
    return { ensName: name, address: target };
  },
  close() {},
};
const app = createApp(config);
let browser;
try {
  app.listen(port, '127.0.0.1');
  await once(app, 'listening');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.exposeFunction('managedTestRpc', async ({ method, params = [] }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet.address];
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'personal_sign') return wallet.signMessage(Buffer.from(params[0].slice(2), 'hex'));
    throw new Error(`Unexpected wallet method: ${method}`);
  });
  await page.addInitScript(() => {
    window.ethereum = { request: request => window.managedTestRpc(request), on() {}, removeListener() {} };
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#connect').click();
  await page.getByText('Payment recorded; ENS activation is pending.', { exact: false }).waitFor();
  assert.equal(await page.locator('#player').textContent(), (await page.evaluate(async () => (await (await fetch('/api/session')).json()))).playerName);

  await names.activateManagedName('builder', accountId, 'order-1', 'payment-1', async () => wallet.address);
  const expiresAt = names.lookup('builder').expires_at;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Active until', { exact: false }).waitFor();
  assert.equal(await page.locator('#player').textContent(), 'builder.minemine.eth');
  assert.match(await page.locator('#managed-name-status').textContent(), /Renewal checkout is not available yet/);

  target = other.address;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Name hidden while its ENS address record cannot be verified.', { exact: false }).waitFor();
  assert.notEqual(await page.locator('#player').textContent(), 'builder.minemine.eth');

  target = wallet.address;
  now = expiresAt;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#connect').waitFor({ state: 'visible' });
  await page.locator('#connect').click();
  await page.getByText('Term ended', { exact: false }).waitFor();
  assert.equal(await page.locator('#address').textContent(), wallet.address);
  assert.notEqual(await page.locator('#player').textContent(), 'builder.minemine.eth');
  assert.match(await page.locator('#managed-name-status').textContent(), /wallet account still works/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'managed-name panel must fit mobile');
  mkdirSync('runtime', { recursive: true });
  await page.screenshot({ path: 'runtime/managed-name-expired-mobile.png', fullPage: true });
  assert.deepEqual(pageErrors, []);
  console.log('PASS managed-name pending, active, unverified and expired states in signed wallet browser session.');
} finally {
  await browser?.close();
  if (app.listening) await new Promise(resolve => app.close(resolve));
  names.close();
  rmSync(worldDir, { recursive: true, force: true });
}
