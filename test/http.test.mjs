import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { Wallet } from 'ethers';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';

async function fixture(t, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'miners-http-'));
  const config = { ...readConfig(env), worldDir: dir };
  const server = createApp(config);
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });
  const origin = config.origin;
  // Exercise the actual Node request handler without a listening socket. The
  // separate integration/socket.mjs suite exercises real HTTP when permitted.
  const request = async (route, data, cookie, extra = {}, remoteAddress = '127.0.0.1') => {
    const headers = Object.fromEntries(Object.entries({ Host: new URL(origin).host, ...(data !== undefined ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra }).map(([k,v]) => [k.toLowerCase(), v]));
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    Object.assign(req, { url: route, method: data === undefined ? 'GET' : 'POST', headers, socket: { remoteAddress } });
    const resultHeaders = new Map();
    const chunks = [];
    const res = new Writable({ write(chunk, encoding, done) { chunks.push(chunk); done(); } });
    res.setHeader = (key, value) => resultHeaders.set(key.toLowerCase(), value);
    res.writeHead = (code, values = {}) => { res.statusCode = code; res.headersSent = true; for (const [k,v] of Object.entries(values)) res.setHeader(k,v); };
    const finished = new Promise((resolve, reject) => { res.on('finish', resolve); res.on('error', reject); });
    await server.listeners('request')[0](req, res);
    await finished;
    return { status: res.statusCode, text: async () => Buffer.concat(chunks).toString(), json: async () => JSON.parse(Buffer.concat(chunks).toString()), headers: { get: key => resultHeaders.get(key.toLowerCase()), getSetCookie: () => [resultHeaders.get('set-cookie')].flat() } };
  };
  return { origin, request, worldDir: dir };
}
test('native heartbeat reports a live world and expires after shutdown', async t => {
  const { request, worldDir } = await fixture(t);
  const heartbeat = path.join(worldDir, 'minemine-server-heartbeat');
  assert.equal((await (await request('/api/health')).json()).nativeReady, false);
  writeFileSync(heartbeat, 'online\n');
  assert.equal((await (await request('/api/health')).json()).nativeReady, true);
  const old = new Date(Date.now() - 11_000);
  utimesSync(heartbeat, old, old);
  assert.equal((await (await request('/api/health')).json()).nativeReady, false);
  rmSync(heartbeat);
  assert.equal((await (await request('/api/health')).json()).nativeReady, false);
});
test('HTTP wallet flow: challenge, real signature, cookie session, gated game, logout', async t => {
  const { request } = await fixture(t);
  const wallet = new Wallet('0x' + '11'.repeat(32));
  let response = await request('/api/auth/challenge', { address: wallet.address, chainId: 11155111 });
  assert.equal(response.status, 200);
  const challengeCookie = response.headers.getSetCookie()[0].split(';')[0];
  const challenge = await response.json();
  const signature = await wallet.signMessage(challenge.message);
  const wrongBrowser = await request('/api/auth/verify', { signature });
  assert.equal(wrongBrowser.status, 401);
  response = await request('/api/auth/verify', { signature }, challengeCookie);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).address, wallet.address);
  const cookieHeader = response.headers.getSetCookie()[0];
  assert.match(cookieHeader, /HttpOnly; SameSite=Strict; Path=\//);
  const sessionCookie = cookieHeader.split(';')[0];
  assert.equal((await request('/api/session', undefined, sessionCookie)).status, 200);
  assert.deepEqual(await (await request('/api/currency/recipient?input=' + wallet.address, undefined, sessionCookie)).json(), { address: wallet.address, ensName: null });
  assert.equal((await (await request('/api/identity', undefined, sessionCookie)).json()).ensName, null);
  assert.equal((await request('/api/currency/recipient?input=builder.eth', undefined, sessionCookie)).status, 503);
  assert.equal((await request('/api/game/ticket', {}, sessionCookie)).status, 503);
  const balance = await request('/api/currency/balance', undefined, sessionCookie);
  assert.deepEqual(await balance.json(), { configured: false });
  assert.equal((await request('/api/auth/verify', { signature }, challengeCookie)).status, 401);
  assert.equal((await request('/api/auth/logout', {}, sessionCookie)).status, 200);
  assert.equal((await request('/api/session', undefined, sessionCookie)).status, 401);
});
test('HTTP rejects cross-origin writes and unauthenticated game credentials', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/auth/challenge', {}, null, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('/api/game/ticket', {})).status, 401);
  assert.equal((await request('/api/config', undefined, null, { Host: 'attacker.example' })).status, 400);
});
test('static files supply isolation headers; private paths and invalid bodies are refused', async t => {
  const { request } = await fixture(t);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(page.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.match(await page.text(), /MineMine/);
  assert.ok(!page.headers.get('Content-Security-Policy').includes("style-src 'self' 'unsafe-inline'"));
  const screenshot = await request('/screenshots/crafting-playtest.jpg');
  assert.equal(screenshot.status, 200);
  assert.equal(screenshot.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(screenshot.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');
  const etag = screenshot.headers.get('ETag');
  assert.match(etag, /^W\/"[0-9a-f-]+"$/);
  const unchanged = await request('/screenshots/crafting-playtest.jpg', undefined, null, { 'If-None-Match': etag });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  assert.equal(unchanged.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  const engine = await request('/engine/not-installed.html');
  assert.equal(engine.status, 404);
  assert.ok(engine.headers.get('Content-Security-Policy').includes("style-src 'self' 'unsafe-inline'"));
  assert.ok(engine.headers.get('Content-Security-Policy').includes("script-src-attr 'unsafe-inline'"));
  const remoteFrame = await request('/engine/connect.html');
  assert.ok(remoteFrame.headers.get('Content-Security-Policy').includes("frame-ancestors 'self'"));
  const config = await request('/api/config');
  assert.equal(config.headers.get('Cache-Control'), 'no-store');
  const { soloPlaytestAvailable } = await config.json();
  assert.equal(typeof soloPlaytestAvailable, 'boolean');
  const play = await request('/play/');
  assert.equal(play.status, 302);
  assert.equal(play.headers.get('Location'), soloPlaytestAvailable ? '/engine/index.html' : 'https://cupojoseph.github.io/minemine/play/');
  for (const route of ['/.env', '/%2e%2e%2fpackage.json', '/server/auth.mjs', '/%00']) assert.equal((await request(route)).status, 404);
  const tooBig = await request('/api/auth/challenge', { data: 'x'.repeat(9000) });
  assert.equal(tooBig.status, 413);
  const wrongType = await request('/api/auth/challenge', {}, null, { 'Content-Type': 'text/plain' });
  assert.equal(wrongType.status, 415);
});
test('rate limiting bounds anonymous authentication attempts', async t => {
  const { request } = await fixture(t);
  let response;
  for (let n = 0; n < 121; n++) response = await request('/api/config');
  assert.equal(response.status, 429);
});
test('trusted local Caddy gives visitors separate limits and cannot be spoofed by a remote peer', async t => {
  const { request } = await fixture(t, { PUBLIC_ORIGIN: 'https://play.example', TRUST_LOOPBACK_PROXY: 'true' });
  const first = { 'X-MineMine-Client-IP': '198.51.100.1' };
  const second = { 'X-MineMine-Client-IP': '198.51.100.2' };
  for (let n = 0; n < 120; n++) assert.equal((await request('/api/config', undefined, undefined, first)).status, 200);
  assert.equal((await request('/api/config', undefined, undefined, first)).status, 429);
  assert.equal((await request('/api/config', undefined, undefined, second)).status, 200);
  const remote = '203.0.113.9';
  for (let n = 0; n < 120; n++) {
    assert.equal((await request('/api/config', undefined, undefined,
      { 'X-MineMine-Client-IP': `198.51.100.${n % 20 + 10}` }, remote)).status, 200);
  }
  assert.equal((await request('/api/config', undefined, undefined, second, remote)).status, 429);
  const invalid = { 'X-MineMine-Client-IP': '198.51.100.3, 198.51.100.4' };
  for (let n = 0; n < 120; n++) assert.equal((await request('/api/config', undefined, undefined, invalid)).status, 200);
  assert.equal((await request('/api/config', undefined, undefined, invalid)).status, 429);
});
