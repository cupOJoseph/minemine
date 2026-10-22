import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Wallet } from 'ethers';
import { chromium } from 'playwright';

const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
const logPath = process.env.NATIVE_LOG || 'runtime/browser-native-restart.log';
const worldDir = process.env.WORLD_DIR || 'runtime/native-world';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function signedSession(wallet) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  const challengeResponse = await fetch(origin + '/api/auth/challenge', {
    method: 'POST', headers, body: JSON.stringify({ address: wallet.address, chainId: 11155111 }),
  });
  assert.equal(challengeResponse.status, 200, 'wallet challenge after restart');
  const challenge = await challengeResponse.json();
  const challengeCookie = challengeResponse.headers.getSetCookie()[0].split(';')[0];
  const verifyResponse = await fetch(origin + '/api/auth/verify', {
    method: 'POST', headers: { ...headers, Cookie: challengeCookie },
    body: JSON.stringify({ signature: await wallet.signMessage(challenge.message) }),
  });
  assert.equal(verifyResponse.status, 200, 'wallet signature after restart');
  const session = await verifyResponse.json();
  const cookie = verifyResponse.headers.getSetCookie().find(value => value.startsWith('miners_session='));
  assert.ok(cookie, 'session cookie after restart');
  return { session, cookie: cookie.split(';')[0] };
}

async function waitForJoin(character, page) {
  const pattern = new RegExp(`${character.playerName} \\[.*\\] joins game\\.`);
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const log = await readFile(logPath, 'utf8').catch(() => '');
    if (pattern.test(log)) return;
    const alert = await page.locator('[role="alert"]').first().textContent({ timeout: 1000 }).catch(() => '');
    if (alert) throw new Error('Browser engine reported an error after restart.');
    await sleep(2000);
  }
  throw new Error(`Native restart join absent for ${character.playerName}.`);
}

const config = JSON.parse(await readFile(path.join(worldDir, 'town-probe-config.json'), 'utf8'));
assert.equal(config.phase, 'restart', 'restart probe was not armed');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const contexts = [];
const errors = [];
try {
  for (const [key, expected] of [
    ['12', config.owner], ['13', config.guest],
  ]) {
    const { session, cookie } = await signedSession(new Wallet('0x' + key.repeat(32)));
    assert.equal(session.playerName, expected, 'wallet identity changed across native restart');
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    contexts.push(context);
    const [name, value] = cookie.split('=');
    await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(origin + '/engine/connect.html', { waitUntil: 'domcontentloaded' });
    await waitForJoin(session, page);
    console.log(`Native Luanti accepted ${session.playerName} after restart.`);
  }
  let result = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    result = await readFile(path.join(worldDir, 'town-probe-restart-result.txt'), 'utf8').catch(() => '');
    if (result) break;
    await sleep(1000);
  }
  assert.match(result, /^PASS /, `native restart probe failed: ${result || 'no result'}`);
  assert.equal(errors.length, 0, 'browser console errors after restart');
  console.log(result.trim());
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
