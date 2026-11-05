import assert from 'node:assert/strict';
import { appendFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Wallet } from 'ethers';
import { chromium } from 'playwright';

const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
const worldDir = process.env.WORLD_DIR || 'runtime/native-world';
const logPath = process.env.NATIVE_LOG || 'runtime/browser-native.log';
const output = process.env.LOAD_RESULTS || 'runtime/native-load-snapshots.jsonl';
const joinOutput = process.env.LOAD_JOIN_RESULTS || 'runtime/native-load-joins.jsonl';
const movementOutput = process.env.LOAD_MOVEMENT_RESULTS || 'runtime/native-load-movement.json';
const maxClients = Number(process.env.LOAD_MAX_CLIENTS || 16);
assert.ok([16, 20, 32].includes(maxClients), 'load rehearsal supports 16, 20, or 32 clients');
const stages = maxClients === 16 ? [2, 4, 8, 16] : [2, 4, 8, 16, maxClients];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function watchGameSocket(page, markers, traffic) {
  // Counts game frame payload only; HTTP assets, WebSocket framing and TLS are excluded.
  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname !== '/game-proxy') return;
    if (!markers.proxy_at) markers.proxy_at = Date.now();
    socket.on('framereceived', ({ payload }) => {
      traffic.egress_payload_bytes += Buffer.byteLength(payload);
      traffic.egress_frames++;
    });
    socket.on('framesent', ({ payload }) => {
      traffic.ingress_payload_bytes += Buffer.byteLength(payload);
      traffic.ingress_frames++;
    });
  });
}

function gameTrafficTotals(records) {
  return records.reduce((total, record) => {
    for (const key of Object.keys(total)) total[key] += record[key];
    return total;
  }, { egress_payload_bytes: 0, ingress_payload_bytes: 0, egress_frames: 0, ingress_frames: 0 });
}

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

async function waitForJoin(playerName, page, logOffset = 0) {
  const joinText = `${playerName} [`;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const log = await readFile(logPath, 'utf8').catch(() => '');
    const recentLines = log.slice(logOffset).split('\n');
    const joined = recentLines.find(line => line.includes(joinText) && line.includes('] joins game.'));
    if (joined) {
      const connected = recentLines.find(line => line.includes(`New connection: "${playerName}"`));
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

async function waitForPresence(expectedNames) {
  const deadline = Date.now() + 60_000;
  const expected = [...expectedNames].sort();
  while (Date.now() < deadline) {
    const raw = await readFile(path.join(worldDir, 'minemine-player-presence.json'), 'utf8').catch(() => '');
    if (raw) {
      const snapshot = JSON.parse(raw);
      if (JSON.stringify([...snapshot.players].sort()) === JSON.stringify(expected)) return;
    }
    await sleep(1000);
  }
  throw new Error(`Native presence did not match ${expected.length} expected characters`);
}

async function requestPositions(label) {
  const snapshotPath = path.join(worldDir, `minemine-load-position-${label}.json`);
  const previous = await readFile(snapshotPath, 'utf8').catch(() => '');
  await writeFile(path.join(worldDir, `minemine-load-position-${label}.request`), 'capture\n', { mode: 0o600 });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const raw = await readFile(snapshotPath, 'utf8').catch(() => '');
    if (raw && raw !== previous) return JSON.parse(raw);
    await sleep(500);
  }
  throw new Error(`Native ${label} position snapshot did not arrive`);
}

async function prepareMovement(actorNames) {
  const resultPath = path.join(worldDir, 'minemine-load-prepare-result.json');
  const requestPath = path.join(worldDir, 'minemine-load-prepare.json');
  const temporaryPath = `${requestPath}.${process.pid}.tmp`;
  await rm(resultPath, { force: true });
  await writeFile(temporaryPath,
    `${JSON.stringify({ players: actorNames })}\n`, { mode: 0o600 });
  await rename(temporaryPath, requestPath);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const raw = await readFile(resultPath, 'utf8').catch(() => '');
    if (raw) {
      const result = JSON.parse(raw);
      assert.deepEqual(result, { ready: true, count: actorNames.length }, 'native movement pads must be ready');
      return;
    }
    await sleep(500);
  }
  throw new Error('Native movement pads were not prepared');
}

await writeFile(output, '');
await writeFile(joinOutput, '');
const browsers = [];
const contexts = [];
const pages = [];
const names = new Set();
const gameTraffic = [];
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
      pages.push(page);
      const markers = {};
      const traffic = { egress_payload_bytes: 0, ingress_payload_bytes: 0, egress_frames: 0, ingress_frames: 0 };
      gameTraffic.push(traffic);
      page.on('response', response => {
        if (new URL(response.url()).pathname === '/api/game/ticket' && response.status() === 200)
          markers.ticket_at = Date.now();
      });
      watchGameSocket(page, markers, traffic);
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
      await appendFile(output, `${JSON.stringify({ stage, captured_at: new Date().toISOString(),
        game_websocket_payload: gameTrafficTotals(gameTraffic), ...snapshot })}\n`);
      console.log(`Stage ${stage}, sample ${sample + 1}: ${snapshot.online_players} online, p95 ${snapshot.step_interval_ms_p95.toFixed(1)} ms`);
    }
  }
  const actorNames = [...names].slice(0, 8);
  const actorPages = pages.slice(0, actorNames.length);
  // All new characters share one spawn coordinate. Separate the actors on
  // disposable pads so crowding cannot masquerade as a failed input packet.
  await prepareMovement(actorNames);
  await sleep(5_000);
  const beforePositions = await requestPositions('before');
  assert.equal(beforePositions.count, maxClients, 'movement baseline needs every native player');
  const beforeTraffic = gameTrafficTotals(gameTraffic);
  const beforeStep = await waitForOnline(maxClients);
  const movementKeys = ['w', 'a', 's', 'd', 'w', 'a', 's', 'd'];
  for (const page of actorPages) {
    await page.locator('#canvas').click({ timeout: 10_000 });
    await page.waitForFunction(() => document.pointerLockElement?.id === 'canvas', null, { timeout: 10_000 });
  }
  await Promise.all(actorPages.map((page, index) => page.keyboard.down(movementKeys[index])));
  try {
    await sleep(8_000);
  } finally {
    await Promise.all(actorPages.map((page, index) => page.keyboard.up(movementKeys[index]).catch(() => {})));
  }
  await sleep(2_000);
  const afterPositions = await requestPositions('after');
  assert.equal(afterPositions.count, maxClients, 'movement activity lost a native player');
  const displacements = actorNames.map((playerName, index) => {
    const before = beforePositions.positions[playerName];
    const after = afterPositions.positions[playerName];
    assert.ok(before && after, `movement actor ${index + 1} missing from native position snapshots`);
    return Math.hypot(after.x - before.x, after.z - before.z);
  });
  const moved = displacements.filter(distance => distance >= 0.5).length;
  assert.ok(moved >= 2, `only ${moved} of eight browser actors moved at least half a block`);
  let activityStep;
  const activityDeadline = Date.now() + 45_000;
  do {
    activityStep = await waitForOnline(maxClients);
    if (activityStep.observed_at > beforeStep.observed_at) break;
    await sleep(1000);
  } while (Date.now() < activityDeadline);
  assert.ok(activityStep.observed_at > beforeStep.observed_at, 'movement needs a fresh native step window');
  const afterTraffic = gameTrafficTotals(gameTraffic);
  const trafficDelta = Object.fromEntries(Object.keys(afterTraffic).map(key => [key, afterTraffic[key] - beforeTraffic[key]]));
  await writeFile(movementOutput, `${JSON.stringify({ actors: actorNames.length, moved,
    horizontal_displacement_blocks: displacements, step_interval_ms_p95: activityStep.step_interval_ms_p95,
    online_players: activityStep.online_players, game_websocket_payload_delta: trafficDelta })}\n`);
  await appendFile(output, `${JSON.stringify({ stage: maxClients, phase: 'movement',
    captured_at: new Date().toISOString(), game_websocket_payload: afterTraffic, ...activityStep })}\n`);
  console.log(`Movement with ${maxClients} online: ${moved}/8 actors moved at least half a block; ` +
    `p95 native step ${activityStep.step_interval_ms_p95.toFixed(1)} ms`);
  const observedTraffic = gameTrafficTotals(gameTraffic);
  assert.ok(observedTraffic.egress_payload_bytes > 0 && observedTraffic.ingress_payload_bytes > 0,
    'browser game WebSocket payload counters stayed empty');
  const reconnectClient = stages.at(-1);
  const originalName = [...names].at(-1);
  await waitForPresence(names);
  await contexts.at(-1).close();
  await browsers.at(-1).close();
  contexts.pop();
  browsers.pop();
  pages.pop();
  const disconnected = await waitForOnline(reconnectClient - 1);
  await waitForPresence([...names].filter(playerName => playerName !== originalName));
  await appendFile(output, `${JSON.stringify({ stage: reconnectClient, phase: 'one-disconnected',
    captured_at: new Date().toISOString(), game_websocket_payload: gameTrafficTotals(gameTraffic),
    ...disconnected })}\n`);

  const wallet = new Wallet(`0x${reconnectClient.toString(16).padStart(64, '0')}`);
  const { session, cookie, auth } = await signIn(wallet);
  assert.equal(session.playerName, originalName, 'reconnected wallet must keep its native character');
  const logOffset = (await readFile(logPath, 'utf8')).length;
  const browserStart = Date.now();
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const browserLaunchMs = Date.now() - browserStart;
  browsers.push(browser);
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  contexts.push(context);
  const [name, value] = cookie.split('=');
  await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage();
  pages.push(page);
  const markers = {};
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/game/ticket' && response.status() === 200)
      markers.ticket_at = Date.now();
  });
  watchGameSocket(page, markers, gameTraffic.at(-1));
  const start = Date.now();
  await page.goto(`${origin}/engine/connect.html`, { waitUntil: 'domcontentloaded' });
  const domAt = Date.now();
  const native = await waitForJoin(session.playerName, page, logOffset);
  const totalMs = Date.now() - start;
  assert.ok(markers.ticket_at && markers.proxy_at, 'reconnected browser ticket or game proxy missing');
  const timing = { client: reconnectClient, stage: reconnectClient, reconnect: true,
    browser_mode: 'separate-processes', browser_launch_ms: browserLaunchMs, ...auth,
    dom_content_loaded_ms: domAt - start, ticket_response_ms: markers.ticket_at - start,
    game_proxy_open_ms: markers.proxy_at - start, ...native, total_join_ms: totalMs };
  await appendFile(joinOutput, `${JSON.stringify(timing)}\n`);
  const reconnected = await waitForOnline(reconnectClient);
  assert.ok(reconnected.observed_at > disconnected.observed_at, 'reconnect needs a fresh native snapshot');
  await waitForPresence(names);
  await appendFile(output, `${JSON.stringify({ stage: reconnectClient, phase: 'reconnected',
    captured_at: new Date().toISOString(), game_websocket_payload: gameTrafficTotals(gameTraffic),
    ...reconnected })}\n`);
  console.log(`Client ${reconnectClient} rejoined as ${session.playerName} in ${(totalMs / 1000).toFixed(1)}s; ` +
    `${reconnected.online_players} online again`);
} finally {
  for (const context of contexts.reverse()) await context.close().catch(() => {});
  for (const browser of browsers.reverse()) await browser.close().catch(() => {});
}
