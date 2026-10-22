import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import WebSocket from 'ws';
import { createApp } from '../../server/app.mjs';
import { readConfig } from '../../server/config.mjs';
import { send } from '../helpers/http.mjs';

const MAGIC = 0x778b4cf6;
const MAPPED_LOOPBACK = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 127, 0, 0, 1]);
function frame(port, packet, destination = MAPPED_LOOPBACK) {
  const data = Buffer.alloc(24 + packet.length);
  data.writeUInt32BE(MAGIC, 0);
  destination.copy(data, 4);
  data.writeUInt16BE(port, 20);
  data.writeUInt16BE(packet.length, 22);
  packet.copy(data, 24);
  return data;
}

test('wallet-only WebSocket proxy forwards UDP only to the configured private game port', async t => {
  const worldDir = mkdtempSync(path.join(tmpdir(), 'minemine-proxy-'));
  const game = dgram.createSocket('udp4');
  let received = 0;
  game.on('message', (packet, source) => { received++; game.send(packet, source.port, source.address); });
  game.bind(0, '127.0.0.1');
  await once(game, 'listening');
  const config = { ...readConfig({ GAME_ENABLED: 'true', GAME_PORT: String(game.address().port) }), worldDir };
  const server = createApp(config);
  const clients = [];
  t.after(async () => {
    server.stopGameProxy();
    for (const client of clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
    game.close();
    rmSync(worldDir, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const wsUrl = `ws://127.0.0.1:${server.address().port}/game-proxy`;
  const headers = { Host: 'localhost:3000', Origin: config.origin, 'Content-Type': 'application/json' };
  const wallet = new Wallet('0x' + '11'.repeat(32));
  const challengeResponse = await send(url + '/api/auth/challenge', { method: 'POST', headers, body: JSON.stringify({ address: wallet.address, chainId: config.chainId }) });
  const challenge = await challengeResponse.json();
  const signature = await wallet.signMessage(challenge.message);
  const login = await send(url + '/api/auth/verify', { method: 'POST', headers: { ...headers, Cookie: challengeResponse.headers['set-cookie'][0].split(';')[0] }, body: JSON.stringify({ signature }) });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const options = { headers: { Host: 'localhost:3000', Origin: config.origin, Cookie: cookie } };
  const rejected = new WebSocket(wsUrl, { headers: { Host: 'localhost:3000', Origin: config.origin } });
  clients.push(rejected);
  const [error] = await once(rejected, 'error');
  assert.match(error.message, /403/);

  const assignmentSocket = new WebSocket(wsUrl, options);
  clients.push(assignmentSocket);
  await once(assignmentSocket, 'open');
  assignmentSocket.send('NEWADDR');
  const [reply] = await once(assignmentSocket, 'message');
  const match = /^ADDR fd00::[0-9a-f]+ ([0-9A-F]{48}) [0-9A-F]{12}$/.exec(reply.toString());
  assert.ok(match);
  assignmentSocket.close();
  await once(assignmentSocket, 'close');

  const bound = new WebSocket(wsUrl, options);
  clients.push(bound);
  await once(bound, 'open');
  bound.send(`BIND ${match[1]} UDP 49152`);
  const [ack] = await once(bound, 'message');
  assert.equal(ack.toString(), 'BIND OK');
  const payload = Buffer.from([0x4f, 0x45, 0x74, 0x03, 42]);
  bound.send(frame(config.gamePort, payload));
  const [echo] = await once(bound, 'message');
  assert.equal(echo.readUInt32BE(0), MAGIC);
  assert.deepEqual(echo.subarray(4, 20), MAPPED_LOOPBACK);
  assert.equal(echo.readUInt16BE(20), config.gamePort);
  assert.deepEqual(echo.subarray(24), payload);
  assert.equal(received, 1);

  bound.send(frame(config.gamePort, payload, Buffer.alloc(16, 8)));
  const [code] = await once(bound, 'close');
  assert.equal(code, 1008);
  assert.equal(received, 1);
  assert.throws(() => readConfig({ GAME_ENABLED: 'true', GAME_ADDRESS: '8.8.8.8' }), /127\.0\.0\.1/);
});
