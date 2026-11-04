import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Wallet } from 'ethers';
import { chromium } from 'playwright';

const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
const worldDir = process.env.WORLD_DIR || 'runtime/native-world';
const logPath = process.env.NATIVE_LOG || 'runtime/browser-native.log';
const output = process.env.LOAD_RESULTS || 'runtime/native-load-snapshots.jsonl';
const joinOutput = process.env.LOAD_JOIN_RESULTS || 'runtime/native-load-joins.jsonl';
const stages = [2, 4];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function signIn(wallet) {
  const started = Date.now();
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  const challengeResponse = await fetch(`${origin}/api/auth/challenge`, {
    method: 'POST', headers,
    body: JSON.stringify({ address: wallet.address, chainId: Number(process.env.CHAIN_ID || 11155111) }),
  });
  assert.equal(challengeResponse.status, 200, 'wallet challenge');
  const challenge = await challengeResponse.json();
  const challenged = Date.now();
  const challengeCookie = challengeResponse.headers.getSetCookie()[0].split(';')[0];
  const verifyResponse = await fetch(`${origin}/api/auth/verify`, {
    method: 'POST', headers: { ...headers, Cookie: challengeCookie },
    body: JSON.stringify({ signature: await wallet.signMessage(challenge.message) }),
  });
  assert.equal(verifyResponse.status, 200, 'wallet signature');
  const session = await verifyResponse.json();
  const cookie = verifyResponse.headers.getSetCookie().find(value => value.startsWith('miners_session='));
  assert.ok(cookie, 'wallet session cookie');
  return { session, cookie: cookie.split(';')[0], auth: {
    challenge_ms: challenged - started,
    verify_ms: Date.now() - challenged,
  } };
}

async function waitForJoin(playerName, page) {
  const joinText = `${playerName} [`;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const log = await readFile(logPath, 'utf8').catch(() => '');
    const joined = log.split('\n').find(line => line.includes(joinText) && line.includes('] joins game.'));
    if (joined) {
      const connected = log.split('\n').find(line => line.includes(`New connection: "${playerName}"`));
      assert.ok(connected, `native connection marker missing for ${playerName}`);
      const timestamp = line => Date.parse(`${line.slice(0, 19).replace(' ', 'T')}Z`);
      const connectedAt = timestamp(connected);
      const joinedAt = timestamp(joined);
      assert.ok(Number.isFinite(connectedAt) && Number.isFinite(joinedAt) && joinedAt >= connectedAt,
        `invalid native connection/join timestamps for ${playerName}`);
      return { connected_at: connected.slice(0, 19), joined_at: joined.slice(0, 19),
        native_connection_to_join_ms: joinedAt - connectedAt };
    }
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
await writeFile(joinOutput, '');
const browsers = [];
const contexts = [];
const names = new Set();
try {
  await waitForOnline(0);
  for (const stage of stages) {
    while (contexts.length < stage) {
      const number = contexts.length + 1;
      // Disposable local test wallets. Never fund or reuse these keys.
      const wallet = new Wallet(`0x${number.toString(16).padStart(64, '0')}`);
      const { session, cookie, auth } = await signIn(wallet);
      assert.ok(!names.has(session.playerName), 'each wallet needs a distinct native character');
      names.add(session.playerName);
      const browserStart = Date.now();
      const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
      const browserLaunchMs = Date.now() - browserStart;
      browsers.push(browser);
      const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
      contexts.push(context);
      const [name, value] = cookie.split('=');
      await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: 'Strict' }]);
      const page = await context.newPage();
      const markers = {};
      page.on('response', response => {
        if (new URL(response.url()).pathname === '/api/game/ticket' && response.status() === 200)
          markers.ticket_at = Date.now();
      });
      page.on('websocket', socket => {
        if (new URL(socket.url()).pathname === '/game-proxy' && !markers.proxy_at)
          markers.proxy_at = Date.now();
      });
      const start = Date.now();
      await page.goto(`${origin}/engine/connect.html`, { waitUntil: 'domcontentloaded' });
      const domAt = Date.now();
      const native = await waitForJoin(session.playerName, page);
      const totalMs = Date.now() - start;
      assert.ok(markers.ticket_at && markers.proxy_at, `browser ticket or game proxy missing for client ${number}`);
      const timing = { client: number, stage, browser_mode: 'separate-processes',
        browser_launch_ms: browserLaunchMs, ...auth,
        dom_content_loaded_ms: domAt - start,
        ticket_response_ms: markers.ticket_at - start,
        game_proxy_open_ms: markers.proxy_at - start,
        ...native, total_join_ms: totalMs };
      await appendFile(joinOutput, `${JSON.stringify(timing)}\n`);
      console.log(`Load client ${number}/${stage} joined in ${(totalMs / 1000).toFixed(1)}s; ` +
        `ticket ${(timing.ticket_response_ms / 1000).toFixed(1)}s, ` +
        `proxy ${(timing.game_proxy_open_ms / 1000).toFixed(1)}s, ` +
        `native connection-to-join ${(timing.native_connection_to_join_ms / 1000).toFixed(1)}s`);
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
  for (const browser of browsers.reverse()) await browser.close().catch(() => {});
}
