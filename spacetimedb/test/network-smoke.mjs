import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncPendingProfiles } from '../../server/spacetime-profile-sync.mjs';

const cli = process.env.SPACETIME_CLI || 'spacetime';
const moduleDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = mkdtempSync(path.join(tmpdir(), 'minemine-spacetime-smoke-'));
const database = `minemine-smoke-${randomBytes(5).toString('hex')}`;
const account = '0x1111111111111111111111111111111111111111';
let host;
let hostLog = '';

function capture(chunk) {
  hostLog = (hostLog + chunk.toString()).slice(-4000);
}

async function freeLoopbackPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function identity(origin) {
  const response = await fetch(`${origin}/v1/identity`, { method: 'POST' });
  assert.equal(response.status, 200, 'development identity request');
  const { token } = await response.json();
  assert.ok(typeof token === 'string', 'development identity token');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return { token, claims };
}

async function call(origin, token, args) {
  return fetch(`${origin}/v1/database/${database}/call/upsert_profile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
}

try {
  const version = execFileSync(cli, ['--version'], { encoding: 'utf8' });
  assert.match(version, /spacetimedb tool version 2\.14\.1;/,
    'set SPACETIME_CLI to the SpacetimeDB 2.14.1 CLI');
  const origin = `http://127.0.0.1:${await freeLoopbackPort()}`;
  host = spawn(cli, ['start', '--in-memory', '--data-dir', scratch,
    '--listen-addr', new URL(origin).host, '--non-interactive'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  host.stdout.on('data', capture);
  host.stderr.on('data', capture);
  let bridge;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (host.exitCode !== null) throw new Error(`SpacetimeDB exited early: ${hostLog}`);
    try { bridge = await identity(origin); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(bridge, `SpacetimeDB did not become ready: ${hostLog}`);
  assert.equal(bridge.claims.iss, 'localhost', 'development token issuer');
  assert.ok(bridge.claims.aud?.includes('spacetimedb'), 'development token audience');
  assert.ok(bridge.claims.sub, 'development token subject');

  execFileSync(cli, ['publish', database, '--server', origin, '--module-path', moduleDir,
    '--no-config', '--anonymous', '--yes'], {
    cwd: scratch,
    env: { ...process.env, BRIDGE_ISSUER: 'localhost', BRIDGE_AUDIENCE: 'spacetimedb',
      BRIDGE_SUBJECT: bridge.claims.sub },
    stdio: 'pipe',
  });
  const args = [account, 'alice', 1];
  const created = await call(origin, bridge.token, args);
  assert.equal(created.status, 200, await created.text());
  const replayed = await call(origin, bridge.token, args);
  assert.equal(replayed.status, 200, await replayed.text());
  const stranger = await identity(origin);
  const rejected = await call(origin, stranger.token,
    ['0x2222222222222222222222222222222222222222', 'mallory', 1]);
  assert.equal(rejected.status, 403, 'different subject must not write');
  const anonymous = await fetch(`${origin}/v1/database/${database}/call/upsert_profile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  assert.equal(anonymous.status, 403, 'anonymous caller must not write');
  const projected = { accountId: '0x3333333333333333333333333333333333333333',
    displayName: 'w_33333333333333333', revision: 1 };
  let acknowledged = false;
  assert.equal(await syncPendingProfiles({
    registry: {
      pendingProfileProjections: () => [projected],
      acknowledgeProfileProjection: (accountId, revision) => {
        assert.equal(accountId, projected.accountId);
        assert.equal(revision, 1);
        acknowledged = true;
      },
    },
    databaseOrigin: origin, databaseName: database, token: bridge.token, allowLoopback: true,
  }), 1);
  assert.ok(acknowledged, 'network-confirmed bridge write is acknowledged');
  const sql = await fetch(`${origin}/v1/database/${database}/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'text/plain' },
    body: 'SELECT account_id, display_name, revision FROM player_profile',
  });
  const sqlText = await sql.text();
  assert.equal(sql.status, 200, sqlText);
  const rows = JSON.parse(sqlText)[0]?.rows?.sort((a, b) => a[0].localeCompare(b[0]));
  assert.equal(rows?.length, 2, 'only authorized rows are stored');
  assert.equal(rows[0][0], account);
  assert.equal(rows[0][1], 'alice');
  assert.equal(rows[1][0], projected.accountId);
  assert.equal(rows[1][1], projected.displayName);
  console.log('SpacetimeDB 2.14.1 loopback profile smoke passed: write, replay, rejection, bridge, two rows.');
} finally {
  if (host && host.exitCode === null && host.signalCode === null) {
    host.kill('SIGINT');
    await new Promise(resolve => {
      const timer = setTimeout(() => host.kill('SIGKILL'), 3000);
      host.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  rmSync(scratch, { recursive: true, force: true });
}
