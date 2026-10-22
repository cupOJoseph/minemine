import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { Wallet } from 'ethers';
import { chromium } from 'playwright';

const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
const logPath = process.env.NATIVE_LOG || 'runtime/browser-native.log';
const artifacts = process.env.BROWSER_ARTIFACTS || 'runtime/browser-artifacts';
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
try {
  const wallet = new Wallet('0x' + '12'.repeat(32));
  const { session, cookie } = await signedSession(wallet);
  const [name, value] = cookie.split('=');
  await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(origin + '/engine/connect.html', { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const log = await readFile(logPath, 'utf8').catch(() => '');
    if (log.includes(`${session.playerName} [` ) && log.includes('joins game.')) {
      console.log(`Native Luanti accepted wallet character ${session.playerName}.`);
      break;
    }
    const alert = await page.locator('[role="alert"]').first().textContent({ timeout: 1000 }).catch(() => '');
    if (alert) throw new Error(`Browser engine reported: ${alert}`);
    await sleep(2000);
  }
  const log = await readFile(logPath, 'utf8');
  assert.match(log, new RegExp(`${session.playerName} \\[.*\\] joins game\\.`), 'native server recorded the wallet player joining');
  assert.equal(errors.length, 0, `browser console errors: ${errors.join(' | ')}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: artifacts + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
