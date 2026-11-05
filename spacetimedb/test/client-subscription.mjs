import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function within(promise, label, milliseconds = 10_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function connect(DbConnection, origin, database, token) {
  let resolveConnected;
  let rejectConnected;
  const connected = new Promise((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });
  const connection = DbConnection.builder()
    .withUri(origin)
    .withDatabaseName(database)
    .withToken(token)
    .onConnect((_ctx, identity) => resolveConnected(identity.toHexString()))
    .onConnectError((_ctx, error) => rejectConnected(error))
    .build();
  return { connection, connected: within(connected, 'SDK connection') };
}

function subscribe(connection, tables) {
  return within(new Promise((resolve, reject) => {
    connection.subscriptionBuilder()
      .onApplied(ctx => resolve([...ctx.db.playerDirectory.iter()]))
      .onError((_ctx, error) => reject(error))
      .subscribe(tables.playerDirectory);
  }), 'public directory subscription');
}

export async function verifyClientSubscription({ moduleDir, origin, database, token, bridgeToken,
  account, playerId, projectedPlayerId, call }) {
  const bindingsUrl = pathToFileURL(path.join(moduleDir, 'test/module_bindings/index.ts')).href;
  const { DbConnection, tables } = await import(bindingsUrl);
  assert.ok(tables.playerDirectory, 'generated client can subscribe to public directory');
  assert.ok(!('playerProfile' in tables), 'private wallet table is absent from generated client');

  let first;
  let second;
  try {
    first = connect(DbConnection, origin, database, token);
    const firstIdentity = await first.connected;
    const initialRows = await subscribe(first.connection, tables);
    assert.deepEqual(new Set(initialRows.map(row => row.playerId)),
      new Set([playerId, projectedPlayerId]), 'initial subscription contains both public profiles');
    assert.ok(initialRows.every(row => !('accountId' in row)),
      'subscribed rows never contain wallet addresses');
    const forbiddenPlayerId = 'w_44444444444444444';
    await assert.rejects(first.connection.reducers.upsertProfile({
      accountId: '0x4444444444444444444444444444444444444444',
      playerId: forbiddenPlayerId, displayName: 'mallory', revision: 1n,
    }), 'nonowner SDK client must not write a profile');
    assert.ok(first.connection.db.playerDirectory.playerId.find(forbiddenPlayerId) == null);
    const forbiddenRead = await fetch(`${origin}/v1/database/${database}/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: `SELECT player_id FROM player_directory WHERE player_id = '${forbiddenPlayerId}'`,
    });
    const forbiddenText = await forbiddenRead.text();
    assert.equal(forbiddenRead.status, 200, forbiddenText);
    assert.ok(!forbiddenText.includes(forbiddenPlayerId),
      'rejected SDK write must not reach the public table');

    const changed = within(new Promise(resolve => {
      first.connection.db.playerDirectory.onUpdate((_ctx, before, after) => {
        if (after.playerId === playerId) resolve({ before, after });
      });
    }), 'live public directory update');
    const updated = await call(origin, bridgeToken, [account, playerId, 'alice.eth', 2]);
    assert.equal(updated.status, 200, await updated.text());
    const { before, after } = await changed;
    assert.equal(before.displayName, playerId);
    assert.equal(after.displayName, 'alice.eth');
    assert.equal(after.revision, 2n);
    assert.equal(first.connection.db.playerDirectory.playerId.find(playerId)?.displayName, 'alice.eth');

    first.connection.disconnect();
    second = connect(DbConnection, origin, database, token);
    const secondIdentity = await second.connected;
    assert.equal(secondIdentity, firstIdentity, 'same token retains client identity on reconnect');
    const reloadedRows = await subscribe(second.connection, tables);
    assert.equal(reloadedRows.find(row => row.playerId === playerId)?.displayName, 'alice.eth',
      'new connection receives the latest public revision');
  } finally {
    first?.connection.disconnect();
    second?.connection.disconnect();
  }
}
