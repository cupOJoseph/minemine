import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { Agent, request } from 'node:https';
import { Wallet } from 'ethers';
import WebSocket from 'ws';

const origin = process.env.HOST_REHEARSAL_ORIGIN;
const caFile = process.env.HOST_REHEARSAL_CA;
if (!origin || !caFile || new URL(origin).protocol !== 'https:') throw new Error('Set HTTPS rehearsal origin and local Caddy CA.');
const ca = readFileSync(caFile);
const agent = new Agent({ ca });

function send(route, { method = 'GET', cookie, data } = {}) {
  return new Promise((resolve, reject) => {
    const body = data === undefined ? null : JSON.stringify(data);
    const req = request(origin + route, { method, agent, headers: {
      ...(body ? { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end(body || undefined);
  });
}

const health = await send('/api/health');
assert.equal(health.status, 200);
assert.equal(health.json().nativeReady, true, 'native world heartbeat must be fresh through Caddy');
assert.equal(health.json().gameReady, true, 'browser adapter and native world must be ready together');
assert.equal(health.headers['cache-control'], 'no-store');
const landing = await send('/');
assert.equal(landing.status, 200);
assert.equal(landing.headers['cross-origin-opener-policy'], 'same-origin');
assert.equal(landing.headers['cross-origin-embedder-policy'], 'require-corp');

const wsUrl = origin.replace(/^https:/, 'wss:') + '/game-proxy';
const options = { ca, headers: { Origin: origin } };
const denied = new WebSocket(wsUrl, options);
assert.match((await once(denied, 'error'))[0].message, /403/, 'unsigned WSS upgrade must be denied');

const wallet = new Wallet('0x' + '71'.repeat(32));
const chainId = (await send('/api/config')).json().chainId;
const challenge = await send('/api/auth/challenge', { method: 'POST', data: { address: wallet.address, chainId } });
assert.equal(challenge.status, 200);
const challengeCookie = challenge.headers['set-cookie'][0].split(';')[0];
const signature = await wallet.signMessage(challenge.json().message);
const verified = await send('/api/auth/verify', { method: 'POST', cookie: challengeCookie, data: { signature } });
assert.equal(verified.status, 200);
const cookie = verified.headers['set-cookie'][0].split(';')[0];
const ws = new WebSocket(wsUrl, { ...options, headers: { ...options.headers, Cookie: cookie } });
try {
  await once(ws, 'open');
  ws.send('NEWADDR');
  const match = /^ADDR fd00::[0-9a-f]+ ([0-9A-F]{48}) [0-9A-F]{12}$/.exec((await once(ws, 'message'))[0].toString());
  assert.ok(match, 'authenticated WSS must allocate a private bridge address');
  ws.send(`BIND ${match[1]} UDP 49152`);
  assert.equal((await once(ws, 'message'))[0].toString(), 'BIND OK');
  const closed = once(ws, 'close');
  const logout = await send('/api/auth/logout', { method: 'POST', cookie, data: {} });
  assert.equal(logout.status, 200);
  assert.equal((await closed)[0], 1008, 'wallet logout must close Caddy-proxied WSS');
} finally { ws.terminate(); agent.destroy(); }
console.log('PASS CA-verified HTTPS, isolation headers, native readiness, unsigned WSS denial, wallet WSS bind and logout closure through Caddy.');
