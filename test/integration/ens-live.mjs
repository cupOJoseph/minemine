import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getAddress, Wallet } from 'ethers';
import { createApp } from '../../server/app.mjs';
import { readConfig } from '../../server/config.mjs';
import { createEnsResolver } from '../../server/ens.mjs';

if (!process.env.ENS_RPC_URL) throw new Error('Set ENS_RPC_URL to an Ethereum mainnet RPC before running this opt-in live check.');

// ENS Docs uses this forward-verified primary-name example. Override both
// values when checking a different real name; no test key owns either name.
const name = process.env.ENS_TEST_NAME || 'vitalik.eth';
const address = getAddress(process.env.ENS_TEST_ADDRESS || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
const worldDir = mkdtempSync(path.join(tmpdir(), 'minemine-ens-live-'));
const portProbe = createServer();
await new Promise((resolve, reject) => {
  portProbe.once('error', reject);
  portProbe.listen(0, '127.0.0.1', resolve);
});
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const config = readConfig({
  ...process.env, PUBLIC_ORIGIN: origin, HOST: '127.0.0.1', PORT: String(port),
  WORLD_DIR: worldDir, CHAIN_ID: '11155111', GAME_ENABLED: 'false',
  ENGINE_ADAPTER_READY: 'false', RPC_URL: '', TOKEN_ADDRESS: '', TOWN_CONTRACT_ADDRESS: '',
});
const ens = createEnsResolver(config.ensRpcUrl);
let server;
try {
  assert.equal(await ens.name(address), name, 'live reverse name must resolve forward to the documented wallet');
  assert.deepEqual(await ens.recipient(name), { address, ensName: name }, 'live forward lookup');

  server = createApp(config);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  const wallet = Wallet.createRandom();
  const post = (route, body, cookie) => fetch(origin + route, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const challengeResponse = await post('/api/auth/challenge', { address: wallet.address, chainId: config.chainId });
  assert.equal(challengeResponse.status, 200, 'wallet challenge');
  const challenge = await challengeResponse.json();
  const challengeCookie = challengeResponse.headers.getSetCookie()[0].split(';')[0];
  const loginResponse = await post('/api/auth/verify',
    { signature: await wallet.signMessage(challenge.message) }, challengeCookie);
  assert.equal(loginResponse.status, 200, 'signed wallet login');
  const session = await loginResponse.json();
  const sessionCookie = loginResponse.headers.getSetCookie().find(value => value.startsWith('miners_session=')).split(';')[0];
  const recipientResponse = await fetch(origin + '/api/currency/recipient?input=' + encodeURIComponent(name), {
    headers: { Cookie: sessionCookie }, signal: AbortSignal.timeout(15_000),
  });
  assert.equal(recipientResponse.status, 200, 'authenticated ENS recipient lookup');
  assert.deepEqual(await recipientResponse.json(), { address, ensName: name });
  const identityResponse = await fetch(origin + '/api/identity', {
    headers: { Cookie: sessionCookie }, signal: AbortSignal.timeout(15_000),
  });
  assert.equal(identityResponse.status, 200, 'authenticated identity lookup');
  assert.deepEqual(await identityResponse.json(), { ...session, ensName: null });
  console.log(`PASS live ENS reverse/forward and authenticated MineMine recipient lookup: ${name} → ${address}`);
} finally {
  ens.close();
  if (server) {
    server.stopGameProxy();
    await new Promise(resolve => server.close(resolve));
  }
  rmSync(worldDir, { recursive: true, force: true });
}
