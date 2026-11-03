import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Wallet } from 'ethers';
import { chromium } from 'playwright';

const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
const worldDir = process.env.WORLD_DIR || 'runtime/native-world';
const logPath = process.env.NATIVE_LOG || 'runtime/browser-native.log';
const output = process.env.LOAD_RESULTS || 'runtime/native-load-snapshots.jsonl';
const stages = [2, 4];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function signIn(wallet) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  const challengeResponse = await fetch(`${origin}/api/auth/challenge`, {
    method: 'POST', headers,
    body: JSON.stringify({ address: wallet.address, chainId: Number(process.env.CHAIN_ID || 11155111) }),
  });
  assert.equal(challengeResponse.status, 200, 'wallet challenge');
  const challenge = await challengeResponse.json();
  const challengeCookie = challengeResponse.headers.getSetCookie()[0].split(';')[0];
  const verifyResponse = await fetch(`${origin}/api/auth/verify`, {
    method: 'POST', headers: { ...headers, Cookie: challengeCookie },
    body: JSON.stringify({ signature: await wallet.signMessage(challenge.message) }),
  });
  assert.equal(verifyResponse.status, 200, 'wallet signature');
  const session = await verifyResponse.json();
  const cookie = verifyResponse.headers.getSetCookie().find(value => value.startsWith('miners_session='));
  assert.ok(cookie, 'wallet session cookie');
  return { session, cookie: cookie.split(';')[0] };
}

async function waitForJoin(playerName, page) {
  const match = new RegExp(`${playerName} \\[.*\\] joins game\\.`);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (match.test(await readFile(logPath, 'utf8').catch(() => ''))) return;
    const alert = await page.locator('[role="alert"]').first().textContent({ timeout: 500 }).catch(() => '');
    if (alert) throw new Error(`Browser engine reported: ${alert.slice(0, 200)}`);
    await sleep(1500);
  }
  throw new Error(`Native join timed out for ${playerName}`);
}

async function waitForOnline(expected) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const raw = await readFile(path.join(worldDir, 'minemine-native-metrics.json'), 'utf8').catch(() => '');
    if (raw) {
      const snapshot = JSON.parse(raw);
      if (snapshot.online_players === expected && Date.now() / 1000 - snapshot.observed_at <= 30) return snapshot;
    }
    await sleep(1000);
  }
  throw new Error(`Native metrics did not report ${expected} online players`);
}

await writeFile(output, '');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const contexts = [];
const names = new Set();
try {
  await waitForOnline(0);
  for (const stage of stages) {
    while (contexts.length < stage) {
      const number = contexts.length + 1;
      // Disposable local test wallets. Never fund or reuse these keys.
      const wallet = new Wallet(`0x${number.toString(16).padStart(64, '0')}`);
      const { session, cookie } = await signIn(wallet);
      assert.ok(!names.has(session.playerName), 'each wallet needs a distinct native character');
      names.add(session.playerName);
      const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
      contexts.push(context);
      const [name, value] = cookie.split('=');
      await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: 'Strict' }]);
      const page = await context.newPage();
      const start = Date.now();
      await page.goto(`${origin}/engine/connect.html`, { waitUntil: 'domcontentloaded' });
      await waitForJoin(session.playerName, page);
      console.log(`Load client ${number}/${stage} joined in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    }
    let lastObserved = 0;
    for (let sample = 0; sample < 2; sample++) {
      let snapshot;
      const deadline = Date.now() + 45_000;
      do {
        snapshot = await waitForOnline(stage);
        if (snapshot.observed_at > lastObserved) break;
        await sleep(1000);
      } while (Date.now() < deadline);
      assert.ok(snapshot.observed_at > lastObserved, `stage ${stage} lacked a fresh second snapshot`);
      lastObserved = snapshot.observed_at;
      await appendFile(output, `${JSON.stringify({ stage, captured_at: new Date().toISOString(), ...snapshot })}\n`);
      console.log(`Stage ${stage}, sample ${sample + 1}: ${snapshot.online_players} online, p95 ${snapshot.step_interval_ms_p95.toFixed(1)} ms`);
    }
  }
} finally {
  for (const context of contexts.reverse()) await context.close().catch(() => {});
  await browser.close();
}
