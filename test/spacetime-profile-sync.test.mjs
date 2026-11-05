import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { playerName } from '../server/auth.mjs';
import { createNameRegistry } from '../server/name-registry.mjs';
import { requestServiceToken, syncPendingProfiles } from '../server/spacetime-profile-sync.mjs';

const jwt = 'header.payload.signature';

test('service token uses client credentials without sending the secret in the body', async () => {
  const token = await requestServiceToken({
    clientId: 'bridge-client', clientSecret: 'private-secret',
    tokenUrl: 'http://127.0.0.1:3001/token', allowLoopback: true,
    fetchImpl: async (url, request) => {
      assert.equal(url.href, 'http://127.0.0.1:3001/token');
      assert.equal(request.method, 'POST');
      assert.equal(request.body, 'grant_type=client_credentials');
      assert.equal(request.headers.Authorization,
        `Basic ${Buffer.from('bridge-client:private-secret').toString('base64')}`);
      return Response.json({ access_token: jwt });
    },
  });
  assert.equal(token, jwt);
  await assert.rejects(requestServiceToken({ clientId: 'id', clientSecret: 'secret',
    tokenUrl: 'http://example.com/token' }), /HTTPS endpoint/);
});

test('sync acknowledges confirmed writes and retries only the unacknowledged profile', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-profile-sync-'));
  const registry = createNameRegistry(dir);
  try {
    for (const seed of ['a1', 'b2']) {
      const wallet = new Wallet(`0x${seed.repeat(32)}`);
      registry.recordWalletSignIn({ address: wallet.address, playerName: playerName(wallet.address) });
    }
    const expected = registry.pendingProfileProjections();
    const called = [];
    const fetchImpl = async (url, request) => {
      assert.equal(url.href, 'http://127.0.0.1:3000/v1/database/minemine-pilot/call/upsert_profile?confirmed=true');
      assert.equal(request.headers.Authorization, `Bearer ${jwt}`);
      const args = JSON.parse(request.body);
      called.push(args);
      return new Response('', { status: called.length === 2 ? 503 : 200 });
    };
    await assert.rejects(syncPendingProfiles({ registry,
      databaseOrigin: 'http://127.0.0.1:3000', databaseName: 'minemine-pilot',
      token: jwt, allowLoopback: true, fetchImpl }), /HTTP 503/);
    assert.deepEqual(called, expected.map(row => [row.accountId, row.playerId, row.displayName, row.revision]));
    assert.deepEqual(registry.pendingProfileProjections(), [expected[1]]);
    const retried = await syncPendingProfiles({ registry,
      databaseOrigin: 'http://127.0.0.1:3000', databaseName: 'minemine-pilot',
      token: jwt, allowLoopback: true, fetchImpl });
    assert.equal(retried, 1);
    assert.deepEqual(called[2], [expected[1].accountId, expected[1].playerId, expected[1].displayName, 1]);
    assert.deepEqual(registry.pendingProfileProjections(), []);
    await assert.rejects(syncPendingProfiles({ registry,
      databaseOrigin: 'http://example.com', databaseName: 'minemine-pilot', token: jwt }), /HTTPS endpoint/);
  } finally { registry.close(); rmSync(dir, { recursive: true, force: true }); }
});
