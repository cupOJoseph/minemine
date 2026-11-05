import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { playerName } from '../server/auth.mjs';
import { createNameRegistry } from '../server/name-registry.mjs';
import { createProfileDisplayVerifier, requestServiceToken, syncPendingProfiles } from '../server/spacetime-profile-sync.mjs';

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

test('sync rechecks ENS display before publishing and queues a stable-ID fallback on failure', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minemine-ens-profile-sync-'));
  const registry = createNameRegistry(dir);
  try {
    const wallet = new Wallet('0x' + 'c3'.repeat(32));
    const accountId = wallet.address.toLowerCase();
    const playerId = playerName(wallet.address);
    registry.recordWalletSignIn({ address: wallet.address, playerName: playerId });
    registry.recordVerifiedProfileDisplay(accountId, playerId, 'builder.eth');
    const sent = [];
    const options = { registry, databaseOrigin: 'http://127.0.0.1:3000',
      databaseName: 'minemine-pilot', token: jwt, allowLoopback: true,
      fetchImpl: async (_url, request) => {
        sent.push(JSON.parse(request.body));
        return new Response('', { status: 200 });
      },
    };
    await assert.rejects(syncPendingProfiles(options), /live ownership verifier/);
    assert.equal(sent.length, 0);
    assert.equal(await syncPendingProfiles({ ...options, verifyDisplay: async () => false }), 1);
    assert.deepEqual(sent[0], [accountId, playerId, playerId, 3]);
    assert.deepEqual(registry.pendingProfileProjections(), []);

    registry.recordVerifiedProfileDisplay(accountId, playerId, 'builder.eth');
    const verifyDisplay = createProfileDisplayVerifier({ registry,
      ensResolver: { recipient: async () => { throw new Error('not managed'); } },
      ensOwnership: { verify: async (name, address) => {
        assert.equal(address.toLowerCase(), accountId);
        return { name, version: 'v2' };
      } },
    });
    assert.equal(await syncPendingProfiles({ ...options, verifyDisplay }), 1);
    assert.deepEqual(sent[1], [accountId, playerId, 'builder.eth', 4]);
    const managedVerifier = createProfileDisplayVerifier({
      registry: { managedNameForAccount: () => 'builder.minemine.eth' },
      ensResolver: { recipient: async () => ({ address: wallet.address }) },
      ensOwnership: { verify: async () => { throw new Error('managed name is not wallet-owned'); } },
    });
    assert.equal(await managedVerifier({ accountId, playerId, displayName: 'builder.minemine.eth' }), true);
  } finally { registry.close(); rmSync(dir, { recursive: true, force: true }); }
});
