import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { Wallet } from 'ethers';
import Stripe from 'stripe';
import { createApp } from '../server/app.mjs';
import { AuthError, playerName } from '../server/auth.mjs';
import { readConfig } from '../server/config.mjs';
import { createNameRegistry } from '../server/name-registry.mjs';

async function fixture(t, env = {}, clock, overrides = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'miners-http-'));
  const config = { ...readConfig(env), worldDir: dir, ...(clock ? { now: clock } : {}), ...overrides };
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
  assert.match(await page.text(), /MineMine — Make your mark on a world of blocks/);
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
  const map = await request('/map/');
  assert.equal(map.status, 302);
  assert.equal(map.headers.get('Location'), '/map/index.html');
  assert.match(await (await request('/map/index.html')).text(), /World map snapshot/);
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
test('player statistics require an allowlisted signed wallet', async t => {
  const admin = new Wallet('0x' + '44'.repeat(32));
  const outsider = new Wallet('0x' + '55'.repeat(32));
  const { request, worldDir } = await fixture(t, { ADMIN_WALLET_ADDRESSES: admin.address });
  const join = `${Math.floor(Date.now() / 1000)}\tw_${'a'.repeat(17)}\n`;
  writeFileSync(path.join(worldDir, `minemine-player-joins-${new Date().toISOString().slice(0, 7)}.log`), join);
  writeFileSync(path.join(worldDir, 'minemine-server-heartbeat'), 'online\n');
  writeFileSync(path.join(worldDir, 'minemine-player-presence.json'), JSON.stringify({
    updated_at: Math.floor(Date.now() / 1000), players: [`w_${'a'.repeat(17)}`],
  }));
  const login = async wallet => {
    const challengeResponse = await request('/api/auth/challenge', { address: wallet.address, chainId: 11155111 });
    const challenge = await challengeResponse.json();
    const signature = await wallet.signMessage(challenge.message);
    const challengeCookie = challengeResponse.headers.getSetCookie()[0].split(';')[0];
    const verified = await request('/api/auth/verify', { signature }, challengeCookie);
    assert.equal(verified.status, 200);
    return verified.headers.getSetCookie()[0].split(';')[0];
  };
  assert.equal((await request('/api/admin/stats')).status, 401);
  const outsiderCookie = await login(outsider);
  assert.equal((await request('/api/admin/stats', undefined, outsiderCookie)).status, 403);
  assert.equal((await request('/api/admin/players')).status, 401);
  assert.equal((await request('/api/admin/players', undefined, outsiderCookie)).status, 403);
  const adminCookie = await login(admin);
  const response = await request('/api/admin/stats', undefined, adminCookie);
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.equal(stats.current.count, 1);
  assert.deepEqual(stats.active, { daily: 1, weekly: 1, monthly: 1 });
  assert.equal(stats.periods.timezone, 'UTC');
  const roster = await request('/api/admin/players?page=1', undefined, adminCookie);
  assert.equal(roster.status, 200);
  assert.equal((await roster.json()).players[0].playerName, `w_${'a'.repeat(17)}`);
  assert.equal((await request('/api/admin/players?q=A', undefined, adminCookie)).status, 400);
  assert.equal((await request('/api/admin/players?page=0', undefined, adminCookie)).status, 400);
});

test('admin player explorer links accepted joins to signed wallets and rechecks ENS on inspection', async t => {
  const admin = new Wallet('0x' + '51'.repeat(32));
  const player = new Wallet('0x' + '52'.repeat(32));
  let currentOwner = player.address;
  const { request, worldDir } = await fixture(t, { ADMIN_WALLET_ADDRESSES: admin.address }, undefined, {
    ensOwnership: { verify: async (name, address) => {
      if (name !== 'builder.eth' || address.toLowerCase() !== currentOwner.toLowerCase()) throw new AuthError('This wallet does not own that ENS name.', 403);
      return { name, version: 'v1' };
    } },
  });
  const login = async wallet => {
    const challenge = await request('/api/auth/challenge', { address: wallet.address, chainId: 11155111 });
    const challengeCookie = challenge.headers.getSetCookie()[0].split(';')[0];
    const signature = await wallet.signMessage((await challenge.json()).message);
    const verified = await request('/api/auth/verify', { signature }, challengeCookie);
    assert.equal(verified.status, 200);
    return verified.headers.getSetCookie()[0].split(';')[0];
  };
  const playerCookie = await login(player);
  const name = playerName(player.address);
  assert.equal((await request('/api/identity/ens', { name: 'builder.eth' }, playerCookie)).status, 200);
  const key = new Date().toISOString().slice(0, 7);
  writeFileSync(path.join(worldDir, `minemine-player-joins-${key}.log`), `${Math.floor(Date.now() / 1000)}\t${name}\n`);
  writeFileSync(path.join(worldDir, 'town-admin-roster.json'), JSON.stringify({ version: 1, towns: [{
    name: 'Probe Town', owner: name, members: [], claims: 1, protectedColumns: 9,
  }] }));
  assert.equal((await request(`/api/admin/players/${name}`, undefined, playerCookie)).status, 403);
  assert.equal((await request('/town-admin-roster.json', undefined, playerCookie)).status, 404,
    'the private native roster is never served as a static file');
  const adminCookie = await login(admin);
  const roster = await (await request('/api/admin/players', undefined, adminCookie)).json();
  assert.equal(roster.players[0].walletAddress, player.address.toLowerCase());
  assert.equal((await (await request(`/api/admin/players?q=${player.address}`, undefined, adminCookie)).json()).players[0].playerName, name);
  assert.equal((await request('/api/admin/players?q=0x1234', undefined, adminCookie)).status, 400);
  const profile = await (await request(`/api/admin/players/${name}`, undefined, adminCookie)).json();
  assert.equal(profile.address, player.address.toLowerCase());
  assert.equal(profile.ensName, 'builder.eth');
  assert.equal(profile.playerName, name);
  assert.deepEqual(profile.townMembership.town, {
    name: 'Probe Town', role: 'owner', owner: name, memberCount: 0, claimCount: 1, protectedColumns: 9,
  });
  assert.equal(profile.townMembership.status, 'present');
  assert.equal(JSON.stringify(profile).includes('members'), false, 'admin profile excludes the full private roster');
  currentOwner = admin.address;
  assert.equal((await (await request(`/api/admin/players/${name}`, undefined, adminCookie)).json()).ensName, null);
  writeFileSync(path.join(worldDir, 'town-admin-roster.json'), '{bad');
  assert.equal((await (await request(`/api/admin/players/${name}`, undefined, adminCookie)).json()).townMembership.status, 'unavailable');
  assert.equal((await request('/api/admin/players/not-a-character', undefined, adminCookie)).status, 400);
});

test('admin explorer searches only currently displayed ENS names and active MineMine handles', async t => {
  const admin = new Wallet('0x' + '81'.repeat(32));
  const player = new Wallet('0x' + '82'.repeat(32));
  let ensOwner = player.address;
  let managedTarget = player.address;
  const { request, worldDir } = await fixture(t, { ADMIN_WALLET_ADDRESSES: admin.address }, null, {
    ensOwnership: { async verify(name, address) {
      if (name !== 'builder.eth' || address !== ensOwner) throw new AuthError('This wallet does not own that ENS name.', 403);
      return { name, version: 'v1' };
    } },
    ensResolver: { async name() { return null; }, async recipient(name) {
      assert.equal(name, 'builder.minemine.eth');
      return { ensName: name, address: managedTarget };
    }, close() {} },
  });
  const login = async wallet => {
    const challenge = await request('/api/auth/challenge', { address: wallet.address, chainId: 11155111 });
    const signature = await wallet.signMessage((await challenge.json()).message);
    const verified = await request('/api/auth/verify', { signature }, challenge.headers.getSetCookie()[0].split(';')[0]);
    return verified.headers.getSetCookie()[0].split(';')[0];
  };
  const playerCookie = await login(player);
  const adminCookie = await login(admin);
  const name = playerName(player.address);
  const key = new Date().toISOString().slice(0, 7);
  writeFileSync(path.join(worldDir, `minemine-player-joins-${key}.log`), `${Math.floor(Date.now() / 1000)}\t${name}\n`);
  assert.equal((await request('/api/identity/ens', { name: 'builder.eth' }, playerCookie)).status, 200);
  const search = async q => (await (await request(`/api/admin/players?q=${encodeURIComponent(q)}`, undefined, adminCookie)).json()).players;
  assert.equal((await search('BUILDER.ETH'))[0].playerName, name);
  ensOwner = admin.address;
  assert.equal((await search('builder.eth')).length, 0, 'transferred ENS is not a current public name');
  const names = createNameRegistry(worldDir);
  t.after(() => names.close());
  const accountId = player.address.toLowerCase();
  names.beginCheckout('builder', accountId, 'order-1');
  names.markPaid('builder', accountId, 'order-1', 'payment-1');
  assert.equal((await search('builder')).length, 0, 'a paid-pending handle is not public');
  await names.activateManagedName('builder', accountId, 'order-1', 'payment-1', async () => player.address);
  assert.equal((await search('BUILDER'))[0].playerName, name);
  assert.equal((await search('Builder.MineMine.ETH'))[0].playerName, name);
  managedTarget = admin.address;
  assert.equal((await search('builder')).length, 0, 'a changed ENS record hides the managed name');
  assert.equal((await request('/api/admin/players?q=bad%20name.eth', undefined, adminCookie)).status, 400);
});

test('admin name reservations require an allowlisted fresh signature and prevent duplicate handles', async t => {
  let now = 1_800_000_000_000;
  const admin = new Wallet('0x' + '66'.repeat(32));
  const outsider = new Wallet('0x' + '77'.repeat(32));
  const { request } = await fixture(t, { ADMIN_WALLET_ADDRESSES: admin.address }, () => now);
  const login = async wallet => {
    const challenge = await request('/api/auth/challenge', { address: wallet.address, chainId: 11155111 });
    const challengeCookie = challenge.headers.getSetCookie()[0].split(';')[0];
    const signature = await wallet.signMessage((await challenge.json()).message);
    const verified = await request('/api/auth/verify', { signature }, challengeCookie);
    assert.equal(verified.status, 200);
    return verified.headers.getSetCookie()[0].split(';')[0];
  };
  assert.equal((await request('/api/admin/names')).status, 401);
  assert.equal((await request('/api/admin/audit')).status, 401);
  const outsiderCookie = await login(outsider);
  assert.equal((await request('/api/admin/names/reserve', { handle: 'alice' }, outsiderCookie)).status, 403);
  assert.equal((await request('/api/admin/audit', undefined, outsiderCookie)).status, 403);
  const adminCookie = await login(admin);
  assert.equal((await request('/api/admin/names/reserve', { handle: 'admin' }, adminCookie)).status, 400);
  const reserved = await request('/api/admin/names/reserve', { handle: 'Alice' }, adminCookie);
  assert.equal(reserved.status, 201);
  assert.equal((await reserved.json()).handle, 'alice');
  assert.equal((await request('/api/admin/names/reserve', { handle: 'ALICE' }, adminCookie)).status, 409);
  assert.equal((await (await request('/api/admin/names', undefined, adminCookie)).json()).reservations[0].handle, 'alice');
  assert.equal((await request('/api/admin/names/reserve', { handle: 'builder', intendedAddress: 'not-an-address' }, adminCookie)).status, 400);
  const targeted = await request('/api/admin/names/reserve', { handle: 'builder', intendedAddress: outsider.address }, adminCookie);
  assert.equal(targeted.status, 201);
  assert.equal((await targeted.json()).intendedAccount, outsider.address.toLowerCase());
  assert.equal((await (await request('/api/admin/names', undefined, adminCookie)).json()).reservations.find(row => row.handle === 'builder').intendedAccount,
    outsider.address.toLowerCase());
  now += 5 * 60_000;
  assert.equal((await request('/api/admin/names/release', { handle: 'alice' }, adminCookie)).status, 403);
  assert.equal((await (await request('/api/admin/names', undefined, adminCookie)).json()).reservations.length, 2);
  const freshCookie = await login(admin);
  assert.equal((await request('/api/admin/names/release', { handle: 'alice' }, freshCookie)).status, 200);
  assert.equal((await request('/api/admin/names/release', { handle: 'builder' }, freshCookie)).status, 200);
  assert.equal((await (await request('/api/admin/names', undefined, freshCookie)).json()).reservations.length, 0);
  const audit = await (await request('/api/admin/audit', undefined, freshCookie)).json();
  assert.deepEqual(audit.events.map(event => event.action), ['admin_released', 'admin_released', 'admin_reserved', 'admin_reserved']);
  assert.equal(audit.events[0].target, 'builder');
  assert.equal(audit.events[0].source, 'username');
  assert.equal(audit.events[0].actor, admin.address);
});

test('a MineMine ENS display name cannot bypass a reserved or selected handle', async t => {
  const admin = new Wallet('0x' + 'b1'.repeat(32));
  const alice = new Wallet('0x' + 'b2'.repeat(32));
  const bob = new Wallet('0x' + 'b3'.repeat(32));
  const { request } = await fixture(t, { ADMIN_WALLET_ADDRESSES: admin.address }, null, {
    ensOwnership: { verify: async name => ({ name, version: 'v2' }) },
  });
  const login = async wallet => {
    const challenge = await request('/api/auth/challenge', { address: wallet.address, chainId: 11155111 });
    const signature = await wallet.signMessage((await challenge.json()).message);
    const verified = await request('/api/auth/verify', { signature }, challenge.headers.getSetCookie()[0].split(';')[0]);
    assert.equal(verified.status, 200);
    return verified.headers.getSetCookie()[0].split(';')[0];
  };
  const adminCookie = await login(admin);
  const aliceCookie = await login(alice);
  const bobCookie = await login(bob);
  assert.equal((await request('/api/admin/names/reserve', { handle: 'alice', intendedAddress: alice.address }, adminCookie)).status, 201);
  assert.equal((await request('/api/identity/ens', { name: 'alice.minemine.eth' }, bobCookie)).status, 409);
  assert.equal((await request('/api/identity/ens', { name: 'alice.minemine.eth' }, aliceCookie)).status, 200);
  assert.equal((await request('/api/admin/names/release', { handle: 'alice' }, adminCookie)).status, 200);
  assert.equal((await request('/api/admin/names/reserve', { handle: 'alice' }, adminCookie)).status, 409);
  assert.equal((await request('/api/identity/ens', { name: 'alice.eth' }, bobCookie)).status, 200);
});

test('beta invitations are hashed, wallet bound, and gate shared-world tickets', async t => {
  let now = 1_800_000_000_000;
  const admin = new Wallet('0x' + '88'.repeat(32));
  const player = new Wallet('0x' + '99'.repeat(32));
  const other = new Wallet('0x' + 'aa'.repeat(32));
  const { request } = await fixture(t, { ADMIN_WALLET_ADDRESSES: admin.address, BETA_INVITES_ENABLED: 'true' }, () => now);
  const login = async wallet => {
    const challenge = await request('/api/auth/challenge', { address: wallet.address, chainId: 11155111 });
    const signature = await wallet.signMessage((await challenge.json()).message);
    const verified = await request('/api/auth/verify', { signature }, challenge.headers.getSetCookie()[0].split(';')[0]);
    assert.equal(verified.status, 200);
    return verified.headers.getSetCookie()[0].split(';')[0];
  };
  const adminCookie = await login(admin);
  const playerCookie = await login(player);
  const otherCookie = await login(other);
  assert.equal((await (await request('/api/config')).json()).betaInvitesEnabled, true);
  assert.equal((await request('/play/')).status, 302, 'solo play remains accessible with the beta gate enabled');
  assert.deepEqual(await (await request('/api/beta/status', undefined, playerCookie)).json(), { enabled: true, admitted: false });
  assert.equal((await request('/api/game/ticket', {}, playerCookie)).status, 403);
  assert.equal((await request('/api/admin/beta/codes', undefined, playerCookie)).status, 403);
  const created = await request('/api/admin/beta/codes/create', { maxUses: 1, days: 2, intendedAccount: player.address }, adminCookie);
  assert.equal(created.status, 201);
  const { id, code } = await created.json();
  const listing = await (await request('/api/admin/beta/codes', undefined, adminCookie)).json();
  assert.equal(listing.codes[0].id, id);
  assert.equal(JSON.stringify(listing).includes(code), false);
  assert.equal((await request('/api/beta/redeem', { code }, otherCookie)).status, 400);
  const redeemed = await request('/api/beta/redeem', { code }, playerCookie);
  assert.deepEqual(await redeemed.json(), { admitted: true, alreadyAdmitted: false });
  assert.deepEqual(await (await request('/api/beta/status', undefined, playerCookie)).json(), { enabled: true, admitted: true });
  assert.equal((await request('/api/game/ticket', {}, playerCookie)).status, 503, 'admitted player reaches the normal engine readiness check');
  assert.equal((await request('/api/beta/redeem', { code }, otherCookie)).status, 400);
  assert.equal((await request('/api/admin/beta/codes/revoke', { id }, adminCookie)).status, 200);
  const audit = await (await request('/api/admin/audit', undefined, adminCookie)).json();
  assert.deepEqual(audit.events.map(event => event.action), ['revoked', 'redeemed', 'created']);
  assert.deepEqual(audit.events.map(event => event.target), [id, id, id]);
  assert.equal(audit.events[1].actor, player.address.toLowerCase());
  assert.equal(JSON.stringify(audit).includes(code), false, 'audit never exposes the beta secret');
  assert.equal((await request('/api/game/ticket', {}, playerCookie)).status, 503, 'revoking a code does not erase an existing admission');
  const profile = await (await request(`/api/admin/players/${(await (await request('/api/session', undefined, playerCookie)).json()).playerName}`, undefined, adminCookie)).json();
  assert.equal(profile.betaAdmission.revokedAt, null);
  assert.equal(profile.betaGateEnabled, true);
  assert.equal((await request('/api/admin/beta/admissions/revoke', { address: player.address }, playerCookie)).status, 403);
  assert.equal((await request('/api/admin/beta/admissions/revoke', { address: admin.address }, adminCookie)).status, 400);
  assert.deepEqual(await (await request('/api/admin/beta/admissions/revoke', { address: player.address }, adminCookie)).json(), { revoked: true });
  assert.deepEqual(await (await request('/api/beta/status', undefined, playerCookie)).json(), { enabled: true, admitted: false });
  assert.equal((await request('/api/game/ticket', {}, playerCookie)).status, 403);
  assert.equal((await request('/api/beta/redeem', { code }, playerCookie)).status, 400);
  assert.deepEqual(await (await request('/api/admin/beta/admissions/revoke', { address: player.address }, adminCookie)).json(), { revoked: false });
  assert.deepEqual(await (await request('/api/admin/beta/admissions/restore', { address: player.address }, adminCookie)).json(), { restored: true });
  assert.equal((await request('/api/game/ticket', {}, playerCookie)).status, 503);
  now += 5 * 60_000;
  assert.equal((await request('/api/admin/beta/codes/create', {}, adminCookie)).status, 403);
  assert.equal((await request('/api/admin/beta/admissions/revoke', { address: player.address }, adminCookie)).status, 403);
});

test('selected ENS identity is wallet-bound, rechecked, and removed after ownership transfers', async t => {
  const alice = new Wallet('0x' + '21'.repeat(32));
  const bob = new Wallet('0x' + '22'.repeat(32));
  let owner = alice.address;
  let offline = false;
  const ensOwnership = { async verify(name, address) {
    if (name !== 'builder.eth') throw new AuthError('Enter a valid ENS name.', 400);
    if (offline) throw new AuthError('ENS ownership lookup is temporarily unavailable.', 503);
    if (address !== owner) throw new AuthError('This wallet does not own that ENS name.', 403);
    return { name, version: 'v1' };
  } };
  const { request } = await fixture(t, {}, null, { ensOwnership });
  const login = async wallet => {
    const challenge = await request('/api/auth/challenge', { address: wallet.address, chainId: 11155111 });
    const signature = await wallet.signMessage((await challenge.json()).message);
    const response = await request('/api/auth/verify', { signature }, challenge.headers.getSetCookie()[0].split(';')[0]);
    return response.headers.getSetCookie()[0].split(';')[0];
  };
  const aliceCookie = await login(alice);
  const bobCookie = await login(bob);
  assert.equal((await request('/api/identity/ens', { name: 'builder.eth' })).status, 401);
  assert.equal((await request('/api/identity/ens', { name: 'builder.eth' }, bobCookie)).status, 403);
  assert.equal((await request('/api/identity/ens', { name: 'bad name' }, aliceCookie)).status, 400);
  const selected = await request('/api/identity/ens', { name: 'builder.eth' }, aliceCookie);
  assert.equal(selected.status, 200);
  assert.equal((await selected.json()).selectedEnsName, 'builder.eth');
  assert.equal((await (await request('/api/identity', undefined, aliceCookie)).json()).ensName, 'builder.eth');
  offline = true;
  assert.equal((await (await request('/api/identity', undefined, aliceCookie)).json()).ensName, null, 'unverified names are hidden during RPC outages');
  offline = false;
  assert.equal((await (await request('/api/identity', undefined, aliceCookie)).json()).ensName, 'builder.eth', 'outage does not erase ownership');
  owner = bob.address;
  assert.equal((await (await request('/api/identity', undefined, aliceCookie)).json()).selectedEnsName, null);
  assert.equal((await request('/api/identity/ens', { name: 'builder.eth' }, bobCookie)).status, 200);
  assert.equal((await (await request('/api/identity', undefined, bobCookie)).json()).ensName, 'builder.eth');
  assert.deepEqual(await (await request('/api/identity/ens/clear', {}, bobCookie)).json(), { cleared: true });
  assert.equal((await (await request('/api/identity', undefined, bobCookie)).json()).ensName, null);
});

test('paid managed name displays only while ENS resolves to its signed account wallet', async t => {
  const wallet = new Wallet('0x' + 'd1'.repeat(32));
  const other = new Wallet('0x' + 'd2'.repeat(32));
  let target = wallet.address;
  let offline = false;
  const ensResolver = {
    async name() { return null; },
    async recipient(name) {
      assert.equal(name, 'builder.minemine.eth');
      if (offline) throw new AuthError('ENS lookup unavailable.', 503);
      return { ensName: name, address: target };
    },
    close() {},
  };
  const { request, worldDir } = await fixture(t, {}, null, { ensResolver });
  const challenge = await request('/api/auth/challenge', { address: wallet.address, chainId: 11155111 });
  const signature = await wallet.signMessage((await challenge.json()).message);
  const verified = await request('/api/auth/verify', { signature }, challenge.headers.getSetCookie()[0].split(';')[0]);
  const cookie = verified.headers.getSetCookie()[0].split(';')[0];
  const names = createNameRegistry(worldDir);
  t.after(() => names.close());
  const accountId = wallet.address.toLowerCase();
  names.beginCheckout('builder', accountId, 'order-1');
  names.markPaid('builder', accountId, 'order-1', 'payment-1');
  assert.equal((await (await request('/api/identity', undefined, cookie)).json()).ensName, null, 'payment alone is not issuance');
  await names.activateManagedName('builder', accountId, 'order-1', 'payment-1', async name => (await ensResolver.recipient(name)).address);
  const active = await (await request('/api/identity', undefined, cookie)).json();
  assert.equal(active.ensName, 'builder.minemine.eth');
  assert.equal(active.managedEnsName, 'builder.minemine.eth');
  assert.equal(active.playerName, playerName(wallet.address), 'display names do not change native identity');
  target = other.address;
  assert.equal((await (await request('/api/identity', undefined, cookie)).json()).ensName, null, 'a changed record is hidden');
  offline = true;
  assert.equal((await (await request('/api/identity', undefined, cookie)).json()).ensName, null, 'an ENS outage is hidden');
  offline = false;
  target = wallet.address;
  assert.equal((await (await request('/api/identity', undefined, cookie)).json()).ensName, 'builder.minemine.eth');
});

test('Stripe test webhook needs a raw valid signature and a matching paid session', async t => {
  const sdk = new Stripe('sk_test_minemine_http');
  const secret = 'whsec_minemine_http';
  const wallet = new Wallet('0x' + 'e4'.repeat(32));
  const accountId = wallet.address.toLowerCase();
  const orderId = 'order_1234567890123456';
  const sessionId = 'cs_test_minemine_http';
  const stripeClient = { webhooks: sdk.webhooks, checkout: { sessions: {
    async retrieve(id) {
      assert.equal(id, sessionId);
      return { id, object: 'checkout.session', livemode: false, mode: 'payment', currency: 'usd',
        amount_total: 200, status: 'complete', payment_status: 'paid', client_reference_id: orderId,
        metadata: { order_id: orderId, account_id: accountId, handle: 'builder' },
        line_items: { has_more: false, data: [{ amount_total: 200, currency: 'usd', quantity: 1 }] } };
    },
  } } };
  const { request, worldDir } = await fixture(t, {}, null, { stripeClient, stripeWebhookSecret: secret });
  const names = createNameRegistry(worldDir);
  t.after(() => names.close());
  names.beginCheckout('builder', accountId, orderId);
  const event = { id: 'evt_test_http', object: 'event', livemode: false, type: 'checkout.session.completed',
    data: { object: { id: sessionId } } };
  const payload = JSON.stringify(event);
  const signature = sdk.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal((await request('/api/stripe/webhook', event, null, { Origin: undefined, 'Stripe-Signature': 'bad' })).status, 400);
  assert.equal(names.lookup('builder').state, 'checkout_held');
  const response = await request('/api/stripe/webhook', event, null, { Origin: undefined, 'Stripe-Signature': signature });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(names.lookup('builder').state, 'paid_pending_ens');
  assert.equal((await request('/api/stripe/webhook', event, null, { Origin: undefined, 'Stripe-Signature': signature })).status, 200);
});
