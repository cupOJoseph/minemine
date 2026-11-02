import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { chromium } from 'playwright';
import { createApp } from '../../server/app.mjs';
import { readConfig } from '../../server/config.mjs';

const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const worldDir = mkdtempSync(path.join(os.tmpdir(), 'minemine-beta-player-'));
const admin = new Wallet('0x' + '12'.repeat(32));
const player = new Wallet('0x' + '34'.repeat(32));
const config = readConfig({ PUBLIC_ORIGIN: origin, PORT: String(port), CHAIN_ID: '31337', BETA_INVITES_ENABLED: 'true', ADMIN_WALLET_ADDRESSES: admin.address, WORLD_DIR: worldDir });
const app = createApp(config);
let browser;
try {
  app.listen(port, '127.0.0.1');
  await once(app, 'listening');
  const post = async (route, data, cookie) => fetch(origin + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(data) });
  const adminChallenge = await post('/api/auth/challenge', { address: admin.address, chainId: config.chainId });
  const adminSignature = await admin.signMessage((await adminChallenge.json()).message);
  const adminSession = await post('/api/auth/verify', { signature: adminSignature }, adminChallenge.headers.get('set-cookie').split(';')[0]);
  assert.equal(adminSession.status, 200);
  const adminCookie = adminSession.headers.get('set-cookie').split(';')[0];
  const created = await post('/api/admin/beta/codes/create', { maxUses: 1, days: 1, intendedAccount: player.address }, adminCookie);
  assert.equal(created.status, 201);
  const { code } = await created.json();

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.exposeFunction('betaTestWalletRpc', async ({ method, params = [] }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [player.address];
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'personal_sign') return player.signMessage(Buffer.from(params[0].slice(2), 'hex'));
    throw new Error(`Unexpected beta test wallet method: ${method}`);
  });
  await page.addInitScript(() => {
    window.ethereum = { request: request => window.betaTestWalletRpc(request), on() {}, removeListener() {} };
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#connect').click();
  await page.locator('#beta-invite').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#beta-form').isVisible(), true);
  await page.locator('#beta-code').fill('MM-' + 'X'.repeat(32));
  await page.getByRole('button', { name: 'Redeem' }).click();
  await page.getByText('Invalid or expired beta code.', { exact: true }).waitFor();
  await page.locator('#beta-code').fill(code);
  await page.getByRole('button', { name: 'Redeem' }).click();
  await page.locator('#beta-form').waitFor({ state: 'hidden' });
  assert.match(await page.locator('#beta-status').textContent(), /Invite accepted/);
  assert.deepEqual(await page.evaluate(async () => (await (await fetch('/api/beta/status')).json())), { enabled: true, admitted: true });
  mkdirSync('runtime', { recursive: true });
  await page.screenshot({ path: 'runtime/beta-player-admitted.png', fullPage: true });
  await page.locator('#logout').click();
  await page.locator('#connect').waitFor({ state: 'visible' });
  await page.locator('#connect').click();
  await page.locator('#identity').waitFor({ state: 'visible' });
  await page.locator('#beta-invite').waitFor({ state: 'visible' });
  await page.locator('#beta-form').waitFor({ state: 'hidden' });
  await page.getByText(/Invite accepted\. Shared-world entry/).waitFor();
  assert.equal(await page.locator('#beta-form').isVisible(), false);
  assert.deepEqual(await page.evaluate(async () => (await (await fetch('/api/beta/status')).json())), { enabled: true, admitted: true });
  assert.deepEqual(pageErrors, []);
  console.log('PASS browser wallet sign-in, invalid invite denial, wallet-bound redemption and persistent admission after re-login.');
} finally {
  await browser?.close();
  if (app.listening) await new Promise(resolve => app.close(resolve));
  rmSync(worldDir, { recursive: true, force: true });
}
