import assert from 'node:assert/strict';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
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
async function bindTestInteractionKeys(gamePage) {
  // Headless pointer-lock mouse movement changes the camera during held clicks.
  // Only this disposable browser fixture uses F/G; the engine still sends its
  // ordinary native place/dig interaction packets.
  await gamePage.route('**/engine/remote.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const needle = "  launcher.setLang('en');";
    assert.equal(source.split(needle).length, 2, 'remote launcher keymap insertion point');
    await route.fulfill({ response, body: source.replace(needle,
      `${needle}\n  launcher.overrideConf('keymap_place', 'SYSTEM_SCANCODE_9');\n  launcher.overrideConf('keymap_dig', 'SYSTEM_SCANCODE_10');\n  launcher.overrideConf('mouse_sensitivity', '0.001');`) });
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
async function waitForProbe(filename, label, attempts = 30, interval = 500) {
  let result = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    result = await readFile(path.join(worldDir, filename), 'utf8').catch(() => '');
    if (result) break;
    await sleep(interval);
  }
  assert.match(result, /^PASS /, `${label}: ${result || 'no result'}`);
  return result;
}
async function signalProbe(signal, marker, label) {
  await writeFile(path.join(worldDir, signal), 'ready\n', { mode: 0o600 });
  return waitForProbe(marker, label);
}
async function waitForGuestMap(playerName, logOffset) {
  const pattern = new RegExp(`Server: Player ${playerName},[^\\n]*full map send \\(d=\\d+\\) completed`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const log = await readFile(logPath, 'utf8').catch(() => '');
    if (pattern.test(log.slice(logOffset))) return;
    await sleep(500);
  }
  throw new Error(`Native server did not finish a map send to ${playerName} after arming the dig target.`);
}
async function mouseDigFallback(gamePage, marker) {
  // Headless SDL key input occasionally misses a dig even with the remapped
  // key held. A real held mouse button exercises the same browser game path.
  let result = '';
  await gamePage.mouse.down();
  try {
    for (let attempt = 0; attempt < 30 && !result; attempt++) {
      await sleep(100);
      result = await readFile(path.join(worldDir, marker), 'utf8').catch(() => '');
    }
  } finally {
    await gamePage.mouse.up();
  }
  return result;
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
  await bindTestInteractionKeys(page);
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
  await bindTestInteractionKeys(secondPage);
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

  const canvas = secondPage.locator('#canvas');
  await canvas.waitFor({ state: 'visible', timeout: 60_000 });
  await secondPage.bringToFront();
  await canvas.evaluate(element => { element.tabIndex = 0; });
  await sleep(5000);
  const logBeforeDigTarget = (await readFile(logPath, 'utf8')).length;
  await writeFile(path.join(worldDir, 'town-packet-arm.txt'), 'dig\n', { mode: 0o600 });
  let packetReady = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    packetReady = await readFile(path.join(worldDir, 'town-packet-ready.txt'), 'utf8').catch(() => '');
    if (packetReady) break;
    await sleep(1000);
  }
  assert.match(packetReady, /^PASS /, `native browser-packet target failed: ${packetReady || 'no result'}`);
  // A freshly teleported client can render the nearby wall before the server
  // finishes its first map send. Wait for the pinned server's map-completion
  // marker before using synthetic headless-browser input on that target.
  await waitForGuestMap(secondSession.playerName, logBeforeDigTarget);
  await sleep(5000);
  const bounds = await canvas.boundingBox();
  assert.ok(bounds && bounds.width > 100 && bounds.height > 100, 'game canvas was not usable');
  await secondPage.screenshot({ path: artifacts + '/packet-target.png' });
  await secondPage.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  record(`game canvas pointer lock: ${await secondPage.evaluate(() => document.pointerLockElement?.id || 'none')}`);
  await secondPage.evaluate(() => {
    window.__mineInputProbe = { keys: 0, mouse: 0 };
    document.addEventListener('keydown', event => { if (event.code === 'KeyG') window.__mineInputProbe.keys++; }, true);
    document.addEventListener('mousedown', event => { if (event.button === 0) window.__mineInputProbe.mouse++; }, true);
  });
  await writeFile(path.join(worldDir, 'town-packet-aim.txt'), 'aim\n', { mode: 0o600 });
  let aimReady = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    aimReady = await readFile(path.join(worldDir, 'town-packet-aim-ready.txt'), 'utf8').catch(() => '');
    if (aimReady) break;
    await sleep(500);
  }
  assert.match(aimReady, /^PASS /, `browser camera reset failed: ${aimReady || 'no result'}`);
  await sleep(2000);
  const aimDebug = JSON.parse(await readFile(path.join(worldDir, 'town-packet-debug.json'), 'utf8'));
  assert.ok(aimDebug.aimed && aimDebug.look_dir.x < -0.5 && Math.abs(aimDebug.look_dir.y) < 0.5,
    `browser camera missed protected wall: ${JSON.stringify(aimDebug)}`);
  await secondPage.screenshot({ path: artifacts + '/packet-aimed.png' });
  let packetDig = await readFile(path.join(worldDir, 'town-packet-dig-result.txt'), 'utf8').catch(() => '');
  for (let attempt = 0; attempt < 3 && !packetDig; attempt++) {
    await secondPage.keyboard.down('g');
    if (attempt === 0) {
      await writeFile(path.join(worldDir, 'town-packet-reaim.txt'), 'aim\n', { mode: 0o600 });
      let reaimReady = '';
      for (let check = 0; check < 30; check++) {
        reaimReady = await readFile(path.join(worldDir, 'town-packet-reaim-ready.txt'), 'utf8').catch(() => '');
        if (reaimReady) break;
        await sleep(500);
      }
      assert.match(reaimReady, /^PASS /, `held-dig camera reset failed: ${reaimReady || 'no result'}`);
    }
    await sleep(1500);
    await secondPage.keyboard.up('g');
    await sleep(1000);
    packetDig = await readFile(path.join(worldDir, 'town-packet-dig-result.txt'), 'utf8').catch(() => '');
  }
  if (!packetDig) packetDig = await mouseDigFallback(secondPage, 'town-packet-dig-result.txt');
  record(`dig input state ${JSON.stringify(await secondPage.evaluate(() => ({
    ...window.__mineInputProbe, focused: document.hasFocus(), active: document.activeElement?.id,
    pointerLock: document.pointerLockElement?.id,
  })))}`);
  assert.match(packetDig, /^PASS /, `browser dig packet did not hit protected claim: ${packetDig || 'no result'}`);

  await writeFile(path.join(worldDir, 'town-packet-place-arm.txt'), 'place\n', { mode: 0o600 });
  let placeReady = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    placeReady = await readFile(path.join(worldDir, 'town-packet-place-ready.txt'), 'utf8').catch(() => '');
    if (placeReady) break;
    await sleep(500);
  }
  assert.match(placeReady, /^PASS /, `native browser-place target failed: ${placeReady || 'no result'}`);
  await sleep(2500);
  await writeFile(path.join(worldDir, 'town-packet-place-aim.txt'), 'aim\n', { mode: 0o600 });
  let placeAimReady = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    placeAimReady = await readFile(path.join(worldDir, 'town-packet-place-aim-ready.txt'), 'utf8').catch(() => '');
    if (placeAimReady) break;
    await sleep(500);
  }
  assert.match(placeAimReady, /^PASS /, `browser place camera reset failed: ${placeAimReady || 'no result'}`);
  await sleep(2000);
  await secondPage.screenshot({ path: artifacts + '/packet-place-target.png' });
  let packetPlace = await readFile(path.join(worldDir, 'town-packet-place-result.txt'), 'utf8').catch(() => '');
  for (let attempt = 0; attempt < 3 && !packetPlace; attempt++) {
    await secondPage.keyboard.down('f');
    await sleep(350);
    await secondPage.keyboard.up('f');
    await sleep(1000);
    packetPlace = await readFile(path.join(worldDir, 'town-packet-place-result.txt'), 'utf8').catch(() => '');
  }
  assert.match(packetPlace, /^PASS /, `browser place packet did not hit protected claim: ${packetPlace || 'no result'}`);

  const ownerCanvas = page.locator('#canvas');
  await ownerCanvas.waitFor({ state: 'visible', timeout: 60_000 });
  await page.bringToFront();
  await ownerCanvas.evaluate(element => { element.tabIndex = 0; });
  const ownerBounds = await ownerCanvas.boundingBox();
  assert.ok(ownerBounds && ownerBounds.width > 100 && ownerBounds.height > 100, 'owner game canvas was not usable');
  await page.mouse.move(ownerBounds.x + ownerBounds.width / 2, ownerBounds.y + ownerBounds.height / 2);
  await ownerCanvas.click({ position: { x: ownerBounds.width / 2, y: ownerBounds.height / 2 } });
  await writeFile(path.join(worldDir, 'town-packet-owner-place-arm.txt'), 'place\n', { mode: 0o600 });
  let ownerPlaceReady = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    ownerPlaceReady = await readFile(path.join(worldDir, 'town-packet-owner-place-ready.txt'), 'utf8').catch(() => '');
    if (ownerPlaceReady) break;
    await sleep(500);
  }
  assert.match(ownerPlaceReady, /^PASS /, `native owner-place target failed: ${ownerPlaceReady || 'no result'}`);
  await sleep(2500);
  await writeFile(path.join(worldDir, 'town-packet-owner-place-aim.txt'), 'aim\n', { mode: 0o600 });
  let ownerPlaceAimReady = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    ownerPlaceAimReady = await readFile(path.join(worldDir, 'town-packet-owner-place-aim-ready.txt'), 'utf8').catch(() => '');
    if (ownerPlaceAimReady) break;
    await sleep(500);
  }
  assert.match(ownerPlaceAimReady, /^PASS /, `owner place camera reset failed: ${ownerPlaceAimReady || 'no result'}`);
  await sleep(2000);
  await page.screenshot({ path: artifacts + '/packet-owner-place-target.png' });
  let ownerPlace = await readFile(path.join(worldDir, 'town-packet-owner-place-result.txt'), 'utf8').catch(() => '');
  for (let attempt = 0; attempt < 3 && !ownerPlace; attempt++) {
    await page.keyboard.down('f');
    await sleep(350);
    await page.keyboard.up('f');
    await sleep(1000);
    ownerPlace = await readFile(path.join(worldDir, 'town-packet-owner-place-result.txt'), 'utf8').catch(() => '');
  }
  assert.match(ownerPlace, /^PASS /, `owner browser place packet did not edit own claim: ${ownerPlace || 'no result'}`);

  await writeFile(path.join(worldDir, 'town-packet-owner-dig-arm.txt'), 'dig\n', { mode: 0o600 });
  let ownerDigReady = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    ownerDigReady = await readFile(path.join(worldDir, 'town-packet-owner-dig-ready.txt'), 'utf8').catch(() => '');
    if (ownerDigReady) break;
    await sleep(500);
  }
  assert.match(ownerDigReady, /^PASS /, `native owner-dig target failed: ${ownerDigReady || 'no result'}`);
  await sleep(2500);
  await writeFile(path.join(worldDir, 'town-packet-owner-dig-aim.txt'), 'aim\n', { mode: 0o600 });
  let ownerDigAimReady = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    ownerDigAimReady = await readFile(path.join(worldDir, 'town-packet-owner-dig-aim-ready.txt'), 'utf8').catch(() => '');
    if (ownerDigAimReady) break;
    await sleep(500);
  }
  assert.match(ownerDigAimReady, /^PASS /, `owner dig camera reset failed: ${ownerDigAimReady || 'no result'}`);
  await sleep(2000);
  let ownerDig = await readFile(path.join(worldDir, 'town-packet-owner-dig-result.txt'), 'utf8').catch(() => '');
  for (let attempt = 0; attempt < 3 && !ownerDig; attempt++) {
    await page.keyboard.down('g');
    if (attempt === 0) {
      await writeFile(path.join(worldDir, 'town-packet-owner-dig-reaim.txt'), 'aim\n', { mode: 0o600 });
      let ownerDigReaimReady = '';
      for (let check = 0; check < 30; check++) {
        ownerDigReaimReady = await readFile(path.join(worldDir, 'town-packet-owner-dig-reaim-ready.txt'), 'utf8').catch(() => '');
        if (ownerDigReaimReady) break;
        await sleep(500);
      }
      assert.match(ownerDigReaimReady, /^PASS /, `held owner-dig camera reset failed: ${ownerDigReaimReady || 'no result'}`);
    }
    for (let check = 0; check < 30 && !ownerDig; check++) {
      await sleep(100);
      ownerDig = await readFile(path.join(worldDir, 'town-packet-owner-dig-result.txt'), 'utf8').catch(() => '');
    }
    await page.keyboard.up('g');
    if (!ownerDig) await sleep(500);
  }
  if (!ownerDig) ownerDig = await mouseDigFallback(page, 'town-packet-owner-dig-result.txt');
  assert.match(ownerDig, /^PASS /, `owner browser dig packet did not edit own claim: ${ownerDig || 'no result'}`);

  await secondPage.bringToFront();
  await signalProbe('town-packet-member-place-arm.txt', 'town-packet-member-place-ready.txt', 'invited-member place target');
  await sleep(2500);
  await signalProbe('town-packet-member-place-aim.txt', 'town-packet-member-place-aim-ready.txt', 'invited-member place aim');
  await sleep(2000);
  let memberPlace = await readFile(path.join(worldDir, 'town-packet-member-place-result.txt'), 'utf8').catch(() => '');
  for (let attempt = 0; attempt < 3 && !memberPlace; attempt++) {
    await secondPage.keyboard.down('f');
    await sleep(350);
    await secondPage.keyboard.up('f');
    await sleep(1000);
    memberPlace = await readFile(path.join(worldDir, 'town-packet-member-place-result.txt'), 'utf8').catch(() => '');
  }
  assert.match(memberPlace, /^PASS /, `invited-member browser place did not edit claim: ${memberPlace || 'no result'}`);

  await signalProbe('town-packet-member-dig-arm.txt', 'town-packet-member-dig-ready.txt', 'invited-member dig target');
  await sleep(2500);
  await signalProbe('town-packet-member-dig-aim.txt', 'town-packet-member-dig-aim-ready.txt', 'invited-member dig aim');
  await sleep(2000);
  let memberDig = await readFile(path.join(worldDir, 'town-packet-member-dig-result.txt'), 'utf8').catch(() => '');
  for (let attempt = 0; attempt < 3 && !memberDig; attempt++) {
    await secondPage.keyboard.down('g');
    if (attempt === 0) await signalProbe('town-packet-member-dig-reaim.txt',
      'town-packet-member-dig-reaim-ready.txt', 'held invited-member dig aim');
    for (let check = 0; check < 30 && !memberDig; check++) {
      await sleep(100);
      memberDig = await readFile(path.join(worldDir, 'town-packet-member-dig-result.txt'), 'utf8').catch(() => '');
    }
    await secondPage.keyboard.up('g');
    if (!memberDig) await sleep(500);
  }
  if (!memberDig) memberDig = await mouseDigFallback(secondPage, 'town-packet-member-dig-result.txt');
  assert.match(memberDig, /^PASS /, `invited-member browser dig did not edit claim: ${memberDig || 'no result'}`);

  await signalProbe('town-packet-removed-place-arm.txt', 'town-packet-removed-place-ready.txt', 'removed-member place target');
  await sleep(2500);
  await signalProbe('town-packet-removed-place-aim.txt', 'town-packet-removed-place-aim-ready.txt', 'removed-member place aim');
  await sleep(2000);
  let removedPlace = await readFile(path.join(worldDir, 'town-packet-removed-place-result.txt'), 'utf8').catch(() => '');
  for (let attempt = 0; attempt < 3 && !removedPlace; attempt++) {
    await secondPage.keyboard.down('f');
    await sleep(350);
    await secondPage.keyboard.up('f');
    await sleep(1000);
    removedPlace = await readFile(path.join(worldDir, 'town-packet-removed-place-result.txt'), 'utf8').catch(() => '');
  }
  assert.match(removedPlace, /^PASS /, `removed-member browser place was not denied: ${removedPlace || 'no result'}`);

  // Luanti re-reads auth for privileges during play. Expiring the short-lived
  // ticket must not strip interact from a player who already authenticated.
  const grantPath = path.join(worldDir, 'wallet_grants', `${session.playerName}.json`);
  const expiredGrant = JSON.parse(await readFile(grantPath, 'utf8'));
  expiredGrant.expires_at = Math.floor(Date.now() / 1000) - 1;
  await writeFile(grantPath + '.expired.tmp', JSON.stringify(expiredGrant), { mode: 0o600 });
  await rename(grantPath + '.expired.tmp', grantPath);
  await signalProbe('town-expired-grant-check-arm.txt', 'town-expired-grant-check-result.txt',
    'connected owner privilege after game ticket expiry');

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
  assert.ok(await readFile(grantPath, 'utf8'), 'reconnected wallet has a current game grant');
  const beforeLogout = (await readFile(logPath, 'utf8')).length;
  const logout = await fetch(origin + '/api/auth/logout', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: reSigned.cookie },
    body: '{}',
  });
  assert.equal(logout.status, 200, 'wallet logout');
  assert.equal((await fetch(origin + '/api/session', { headers: { Cookie: reSigned.cookie } })).status,
    401, 'logged-out cookie cannot restore a wallet session');
  assert.equal((await fetch(origin + '/api/game/ticket', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: reSigned.cookie },
    body: '{}',
  })).status, 401, 'logged-out cookie cannot issue another game ticket');
  await assert.rejects(readFile(grantPath, 'utf8'), { code: 'ENOENT' },
    'logout must remove the wallet game grant');
  let logoutDisconnected = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const currentLog = (await readFile(logPath, 'utf8').catch(() => '')).slice(beforeLogout);
    if (currentLog.includes(`${session.playerName} leaves game.`) ||
        currentLog.includes(`${session.playerName} times out.`)) {
      logoutDisconnected = true;
      break;
    }
    await sleep(1000);
  }
  assert.equal(logoutDisconnected, true, 'native server retained a player after wallet logout');
  await writeFile(path.join(worldDir, 'town-probe-config.json'),
    JSON.stringify({ phase: 'restart', owner: session.playerName, guest: secondSession.playerName }), { mode: 0o600 });
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
  const packetReady = await readFile(path.join(worldDir, 'town-packet-ready.txt'), 'utf8').catch(() => '');
  const aimReady = await readFile(path.join(worldDir, 'town-packet-aim-ready.txt'), 'utf8').catch(() => '');
  const reaimReady = await readFile(path.join(worldDir, 'town-packet-reaim-ready.txt'), 'utf8').catch(() => '');
  const packetDig = await readFile(path.join(worldDir, 'town-packet-dig-result.txt'), 'utf8').catch(() => '');
  const placeReady = await readFile(path.join(worldDir, 'town-packet-place-ready.txt'), 'utf8').catch(() => '');
  const placeAimReady = await readFile(path.join(worldDir, 'town-packet-place-aim-ready.txt'), 'utf8').catch(() => '');
  const packetPlace = await readFile(path.join(worldDir, 'town-packet-place-result.txt'), 'utf8').catch(() => '');
  const ownerPlaceReady = await readFile(path.join(worldDir, 'town-packet-owner-place-ready.txt'), 'utf8').catch(() => '');
  const ownerPlaceAimReady = await readFile(path.join(worldDir, 'town-packet-owner-place-aim-ready.txt'), 'utf8').catch(() => '');
  const ownerPlace = await readFile(path.join(worldDir, 'town-packet-owner-place-result.txt'), 'utf8').catch(() => '');
  const ownerDigReady = await readFile(path.join(worldDir, 'town-packet-owner-dig-ready.txt'), 'utf8').catch(() => '');
  const ownerDigAimReady = await readFile(path.join(worldDir, 'town-packet-owner-dig-aim-ready.txt'), 'utf8').catch(() => '');
  const ownerDigReaimReady = await readFile(path.join(worldDir, 'town-packet-owner-dig-reaim-ready.txt'), 'utf8').catch(() => '');
  const ownerDig = await readFile(path.join(worldDir, 'town-packet-owner-dig-result.txt'), 'utf8').catch(() => '');
  const memberPlace = await readFile(path.join(worldDir, 'town-packet-member-place-result.txt'), 'utf8').catch(() => '');
  const memberDig = await readFile(path.join(worldDir, 'town-packet-member-dig-result.txt'), 'utf8').catch(() => '');
  const removedPlace = await readFile(path.join(worldDir, 'town-packet-removed-place-result.txt'), 'utf8').catch(() => '');
  const packetDebug = await readFile(path.join(worldDir, 'town-packet-debug.json'), 'utf8').catch(() => '');
  await writeFile(artifacts + '/diagnostics.json', JSON.stringify({ error: redact(error.message), events, grantExists: Boolean(grant), ticketCaptured: ticketSecrets.length > 0, grantHashMatches, townProbe, reconnectProbe, packetReady, aimReady, reaimReady, packetDig, placeReady, placeAimReady, packetPlace, ownerPlaceReady, ownerPlaceAimReady, ownerPlace, ownerDigReady, ownerDigAimReady, ownerDigReaimReady, ownerDig, memberPlace, memberDig, removedPlace, packetDebug, nativeTail: nativeLog.slice(-5000) }, null, 2));
  console.error('Browser diagnostics:', JSON.stringify(events));
  throw error;
} finally {
  if (reconnectContext) await reconnectContext.close();
  if (secondContext) await secondContext.close();
  await context.close();
  await browser.close();
}
