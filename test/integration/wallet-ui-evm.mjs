import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { ContractFactory, JsonRpcProvider, parseUnits } from 'ethers';
import { chromium } from 'playwright';
import { compile, compileTownBlocks } from '../../scripts/compile-contracts.mjs';
import { createApp } from '../../server/app.mjs';
import { readConfig } from '../../server/config.mjs';

async function freePort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function until(check, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

const worldDir = mkdtempSync(path.join(tmpdir(), 'minemine-wallet-ui-'));
let anvil, provider, app, browser, page;
try {
  const rpcPort = await freePort();
  const appPort = await freePort();
  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  const origin = `http://127.0.0.1:${appPort}`;
  anvil = spawn(process.execPath, [
    fileURLToPath(new URL('../../node_modules/@foundry-rs/anvil/bin.mjs', import.meta.url)),
    '--host', '127.0.0.1', '--port', String(rpcPort), '--chain-id', '31337', '--accounts', '3', '--no-cors',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  anvil.stderr.resume(); // Do not print the development accounts or mnemonic.
  await until(async () => {
    if (anvil.exitCode !== null) throw new Error('Anvil exited before RPC readiness.');
    try {
      const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(500) });
      return (await response.json()).result === '0x7a69';
    } catch { return false; }
  }, 'Anvil RPC');
  provider = new JsonRpcProvider(rpcUrl);
  const treasury = await provider.getSigner(0);
  const wallet = await provider.getSigner(1);
  const recipient = await provider.getSigner(2);
  const treasuryAddress = await treasury.getAddress();
  const walletAddress = await wallet.getAddress();
  const recipientAddress = await recipient.getAddress();
  const unit = value => parseUnits(String(value), 18);
  const tokenBuild = compile();
  const token = await new ContractFactory(tokenBuild.abi, tokenBuild.bytecode, treasury).deploy(treasuryAddress);
  await token.waitForDeployment();
  const townBuild = compileTownBlocks();
  const town = await new ContractFactory(townBuild.abi, townBuild.bytecode, treasury)
    .deploy(await token.getAddress(), treasuryAddress, unit(2));
  await town.waitForDeployment();
  await (await token.transfer(walletAddress, unit(100))).wait();
  const treasuryBeforePurchase = await token.balanceOf(treasuryAddress);

  const config = readConfig({ PUBLIC_ORIGIN: origin, PORT: String(appPort), CHAIN_ID: '31337', RPC_URL: rpcUrl,
    TOKEN_ADDRESS: await token.getAddress(), TOWN_CONTRACT_ADDRESS: await town.getAddress(),
    TOWN_CONFIRMATIONS: '0', WORLD_DIR: worldDir });
  app = createApp(config);
  app.listen(appPort, '127.0.0.1');
  await once(app, 'listening');
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  const walletTransactions = [];
  let confirmations = 0;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', async dialog => { confirmations++; await dialog.accept(); });
  await page.exposeFunction('mineWalletRpc', async ({ method, params = [] }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [walletAddress];
    if (method === 'personal_sign') return wallet.signMessage(Buffer.from(params[0].slice(2), 'hex'));
    if (method === 'eth_sendTransaction') {
      walletTransactions.push(params[0]);
      return provider.send(method, params);
    }
    if (['eth_chainId', 'eth_call', 'eth_getTransactionReceipt'].includes(method)) return provider.send(method, params);
    throw new Error(`Unexpected test wallet method: ${method}`);
  });
  await page.addInitScript(() => {
    window.__mineRejectNextTransaction = false;
    window.__legacyWalletRequests = 0;
    window.ethereum = {
      request() {
        window.__legacyWalletRequests++;
        throw new Error('The unselected legacy wallet was used.');
      },
      on() {}, removeListener() {},
    };
    const walletListeners = new Map();
    const chosenWallet = {
      request(request) {
        if (request.method === 'eth_sendTransaction' && window.__mineRejectNextTransaction) {
          window.__mineRejectNextTransaction = false;
          return Promise.reject(Object.assign(new Error('User rejected transaction'), { code: 4001 }));
        }
        return window.mineWalletRpc(request);
      },
      on(name, listener) {
        if (!walletListeners.has(name)) walletListeners.set(name, new Set());
        walletListeners.get(name).add(listener);
      },
      removeListener(name, listener) { walletListeners.get(name)?.delete(listener); },
    };
    window.__emitChosenWallet = (name, value) => {
      for (const listener of walletListeners.get(name) || []) listener(value);
    };
    const announcement = new CustomEvent('eip6963:announceProvider', { detail: {
      info: { uuid: 'c458a5bb-4986-49eb-b36b-078b9a84c34c', name: 'Mine Test Wallet',
        icon: 'data:image/png;base64,', rdns: 'gg.minemine.test' }, provider: chosenWallet,
    } });
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(announcement));
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#wallet-choice').waitFor({ state: 'visible' });
  await page.locator('#wallet-provider').selectOption({ label: 'Mine Test Wallet' });
  await page.locator('#connect').click();
  await until(async () => page.locator('#identity').isVisible(), 'wallet sign-in');
  await until(async () => (await page.locator('#balance').textContent()).includes('100'), 'initial MINE balance');
  const playerName = await page.locator('#player').textContent();
  assert.match(playerName, /^w_[0-9a-f]{17}$/);
  assert.equal(await page.locator('#address').textContent(), walletAddress);

  await page.locator('#recipient').fill(recipientAddress);
  await page.locator('#amount').fill('5');
  await page.locator('#send').click();
  await until(async () => (await page.locator('#transfer-status').textContent()).includes('Transaction submitted'),
    'wallet transfer submission');
  await until(async () => (await token.balanceOf(recipientAddress)) === unit(5), 'recipient MINE transfer');
  assert.equal(await token.balanceOf(walletAddress), unit(95));

  await page.locator('#town-blocks').fill('9');
  await page.locator('#buy-town-blocks').click();
  await until(async () => (await page.locator('#town-status').textContent()).includes('Purchase mined'),
    'wallet funded town purchase');
  assert.equal(await town.purchased(walletAddress), 9n);
  assert.equal(await token.balanceOf(walletAddress), unit(77));
  assert.equal(await token.balanceOf(treasuryAddress), treasuryBeforePurchase + unit(18));
  assert.equal(await token.allowance(walletAddress, await town.getAddress()), 0n);
  assert.equal(confirmations, 2, 'wallet transfer and town purchase both require confirmation');
  assert.deepEqual(walletTransactions.map(tx => tx.to.toLowerCase()), [
    (await token.getAddress()).toLowerCase(), (await token.getAddress()).toLowerCase(),
    (await town.getAddress()).toLowerCase(),
  ], 'wallet sent a transfer, an exact approval, and a town purchase');

  await page.locator('#sync-town-blocks').click();
  await until(async () => (await page.locator('#town-status').textContent()).includes('Synced 9'),
    'confirmed town credit sync');
  const quotaPath = path.join(worldDir, 'town_quotas', `${playerName}.json`);
  assert.ok(existsSync(quotaPath));
  const quota = JSON.parse(readFileSync(quotaPath, 'utf8'));
  assert.equal(quota.address, walletAddress);
  assert.equal(quota.blocks, 9);
  await page.locator('#recipient').fill(recipientAddress);
  await page.locator('#amount').fill('1');
  await page.evaluate(() => { window.__mineRejectNextTransaction = true; });
  await page.locator('#send').click();
  await until(async () => (await page.locator('#transfer-status').textContent()).includes('Wallet transaction cancelled'),
    'rejected wallet transfer message');
  assert.equal(await token.balanceOf(walletAddress), unit(77));
  assert.equal(await token.balanceOf(recipientAddress), unit(5));
  assert.equal(walletTransactions.length, 3, 'rejected wallet transaction did not reach the chain');
  assert.equal(await page.evaluate(() => window.__legacyWalletRequests), 0,
    'sign-in, transfer, and town purchase must use the selected announced wallet');
  await page.evaluate(() => window.__emitChosenWallet('accountsChanged', []));
  await until(async () => page.locator('#identity').isHidden(), 'account-change sign-out');
  assert.equal(await page.evaluate(async () => (await fetch('/api/session')).status), 401,
    'selected wallet account change revokes the browser session');
  assert.deepEqual(pageErrors, []);
  console.log('PASS selected EIP-6963 wallet signed in, paid, handled a rejected transaction, and revoked its session on account change.');
} finally {
  await browser?.close();
  if (app?.listening) await new Promise(resolve => app.close(resolve));
  provider?.destroy();
  if (anvil && anvil.exitCode === null && anvil.signalCode === null) {
    const exited = once(anvil, 'exit');
    anvil.kill('SIGTERM');
    await exited;
  }
  rmSync(worldDir, { recursive: true, force: true });
}
