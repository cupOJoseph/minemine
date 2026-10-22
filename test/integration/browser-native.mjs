import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Wallet } from 'ethers';
import { chromium } from 'playwright';

const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
const logPath = process.env.NATIVE_LOG || 'runtime/browser-native.log';
const artifacts = process.env.BROWSER_ARTIFACTS || 'runtime/browser-artifacts';
const worldDir = process.env.WORLD_DIR || 'runtime/native-world';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function signedSession(wallet) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  const challengeResponse = await fetch(origin + '/api/auth/challenge', {
    method: 'POST', headers, body: JSON.stringify({ address: wallet.address, chainId: 11155111 }),
  });
  assert.equal(challengeResponse.status, 200, 'wallet challenge');
  const challenge = await challengeResponse.json();
  const challengeCookie = challengeResponse.headers.getSetCookie()[0].split(';')[0];
  const verifyResponse = await fetch(origin + '/api/auth/verify', {
    method: 'POST', headers: { ...headers, Cookie: challengeCookie },
    body: JSON.stringify({ signature: await wallet.signMessage(challenge.message) }),
  });
  assert.equal(verifyResponse.status, 200, 'wallet signature');
  const session = await verifyResponse.json();
  const cookie = verifyResponse.headers.getSetCookie().find(value => value.startsWith('miners_session='));
  assert.ok(cookie, 'session cookie');
  return { session, cookie: cookie.split(';')[0] };
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
let page;
let session;
let secondContext;
let secondPage;
let secondSession;
let reconnectContext;
const events = [];
const ticketSecrets = [];
let leakedCredential = false;
const redact = value => ticketSecrets.reduce((result, secret) => result.replaceAll(secret, '[redacted]'), value);
const record = value => {
  if (ticketSecrets.some(secret => value.includes(secret))) leakedCredential = true;
  if (events.length < 100) events.push(redact(value).slice(0, 500));
};
const errors = [];
function observe(page) {
  page.on('pageerror', error => { errors.push(redact(error.message)); record(`pageerror ${error.message}`); });
  page.on('console', message => {
    const value = message.text();
    record(`console ${message.type()} ${value}`);
    if (message.type() === 'error') errors.push(redact(value).slice(0, 500));
  });
  page.on('requestfailed', request => record(`request failed ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', response => {
    if (response.url().endsWith('/api/game/ticket')) response.json().then(data => { if (data.password) ticketSecrets.push(data.password); }).catch(() => {});
    if (response.url().includes('/api/') || response.status() >= 400) record(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on('websocket', socket => {
    record(`WebSocket opened ${socket.url()}`);
    socket.on('close', () => record(`WebSocket closed ${socket.url()}`));
    socket.on('socketerror', error => record(`WebSocket error ${String(error)}`));
  });
}
const joinCount = (log, name) => [...log.matchAll(new RegExp(`${name} \\[.*\\] joins game\\.`, 'g'))].length;
async function waitForJoin(character, gamePage, minimumCount = 1) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const log = await readFile(logPath, 'utf8').catch(() => '');
    if (joinCount(log, character.playerName) >= minimumCount) {
      console.log(`Native Luanti accepted wallet character ${character.playerName} (join ${minimumCount}).`);
      return;
    }
    const alert = await gamePage.locator('[role="alert"]').first().textContent({ timeout: 1000 }).catch(() => '');
    if (alert) throw new Error(`Browser engine reported: ${redact(alert)}`);
    await sleep(2000);
  }
  throw new Error(`Native join absent for ${character.playerName}.`);
}
try {
  const wallet = new Wallet('0x' + '12'.repeat(32));
  const signed = await signedSession(wallet);
  session = signed.session;
  const { cookie } = signed;
  const [name, value] = cookie.split('=');
  await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  page = await context.newPage();
  observe(page);
  await page.goto(origin + '/engine/connect.html', { waitUntil: 'domcontentloaded' });
  await waitForJoin(session, page);

  const secondWallet = new Wallet('0x' + '13'.repeat(32));
  const secondSigned = await signedSession(secondWallet);
  secondSession = secondSigned.session;
  assert.notEqual(secondSession.playerName, session.playerName, 'distinct wallets need distinct characters');
  for (const character of [session, secondSession]) {
    await writeFile(path.join(worldDir, 'town_quotas', `${character.playerName}.json`),
      JSON.stringify({ name: character.playerName, blocks: 9 }), { mode: 0o600 });
  }
  await writeFile(path.join(worldDir, 'town-probe-config.json'),
    JSON.stringify({ owner: session.playerName, guest: secondSession.playerName }), { mode: 0o600 });
  secondContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const [secondName, secondValue] = secondSigned.cookie.split('=');
  await secondContext.addCookies([{ name: secondName, value: secondValue, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  secondPage = await secondContext.newPage();
  observe(secondPage);
  await secondPage.goto(origin + '/engine/connect.html', { waitUntil: 'domcontentloaded' });
  await waitForJoin(secondSession, secondPage);

  const log = await readFile(logPath, 'utf8');
  if (!new RegExp(`${session.playerName} \\[.*\\] joins game\\.`).test(log)) throw new Error(`Native join absent for ${session.playerName}.`);
  if (!new RegExp(`${secondSession.playerName} \\[.*\\] joins game\\.`).test(log)) throw new Error(`Native join absent for ${secondSession.playerName}.`);
  assert.equal(page.isClosed(), false, 'first browser remains open while second joins');
  let townProbe = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    townProbe = await readFile(path.join(worldDir, 'town-probe-result.txt'), 'utf8').catch(() => '');
    if (townProbe) break;
    await sleep(1000);
  }
  assert.match(townProbe, /^PASS /, `native town probe failed: ${townProbe || 'no result'}`);

  await page.close();
  let disconnected = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    const currentLog = await readFile(logPath, 'utf8').catch(() => '');
    if (currentLog.includes(`${session.playerName} leaves game.`) || currentLog.includes(`${session.playerName} times out.`)) {
      disconnected = true;
      break;
    }
    await sleep(1000);
  }
  assert.equal(disconnected, true, 'native server did not disconnect the closed browser');
  const reSigned = await signedSession(wallet);
  assert.equal(reSigned.session.playerName, session.playerName, 'wallet reconnect must retain character identity');
  reconnectContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const [reconnectName, reconnectValue] = reSigned.cookie.split('=');
  await reconnectContext.addCookies([{ name: reconnectName, value: reconnectValue, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  const reconnectPage = await reconnectContext.newPage();
  observe(reconnectPage);
  await reconnectPage.goto(origin + '/engine/connect.html', { waitUntil: 'domcontentloaded' });
  await waitForJoin(reSigned.session, reconnectPage, 2);
  let reconnectProbe = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    reconnectProbe = await readFile(path.join(worldDir, 'town-probe-reconnect-result.txt'), 'utf8').catch(() => '');
    if (reconnectProbe) break;
    await sleep(1000);
  }
  assert.match(reconnectProbe, /^PASS /, `native reconnect probe failed: ${reconnectProbe || 'no result'}`);

  assert.equal(errors.length, 0, `browser console errors: ${errors.join(' | ')}`);
  assert.equal(leakedCredential, false, 'browser console exposed the short-lived game credential');
} catch (error) {
  const failedPage = secondPage && !secondPage.isClosed() ? secondPage : page;
  if (failedPage && !failedPage.isClosed()) {
    const state = await failedPage.evaluate(() => ({
      title: document.title, text: document.body.innerText.slice(0, 1000),
      isolated: crossOriginIsolated, webgl2: Boolean(document.createElement('canvas').getContext('webgl2')),
    })).catch(e => ({ error: e.message }));
    record(`page state ${JSON.stringify(state)}`);
    await failedPage.screenshot({ path: artifacts + '/failure.png' }).catch(() => {});
  }
  const nativeLog = await readFile(logPath, 'utf8').catch(() => '');
  const grantRaw = await readFile(path.join(worldDir, 'wallet_grants', `${session?.playerName}.json`), 'utf8').catch(() => '');
  const grant = grantRaw ? JSON.parse(grantRaw) : null;
  const expectedHash = ticketSecrets[0] ? createHash('sha1').update(session.playerName + ticketSecrets[0]).digest('base64').replace(/=+$/, '') : null;
  const grantHashMatches = Boolean(grant && expectedHash && grant.password_hash === expectedHash);
  const townProbe = await readFile(path.join(worldDir, 'town-probe-result.txt'), 'utf8').catch(() => '');
  const reconnectProbe = await readFile(path.join(worldDir, 'town-probe-reconnect-result.txt'), 'utf8').catch(() => '');
  await writeFile(artifacts + '/diagnostics.json', JSON.stringify({ error: redact(error.message), events, grantExists: Boolean(grant), ticketCaptured: ticketSecrets.length > 0, grantHashMatches, townProbe, reconnectProbe, nativeTail: nativeLog.slice(-5000) }, null, 2));
  console.error('Browser diagnostics:', JSON.stringify(events));
  throw error;
} finally {
  if (reconnectContext) await reconnectContext.close();
  if (secondContext) await secondContext.close();
  await context.close();
  await browser.close();
}
