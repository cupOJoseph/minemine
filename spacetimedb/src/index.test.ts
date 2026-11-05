import { expect, it } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import moduleSchema, * as moduleExports from './index';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const PLAYER = 'w_11111111111111111';
const bridgeEnv = {
  BRIDGE_ISSUER: 'https://issuer.example.test',
  BRIDGE_AUDIENCE: 'minemine-presence',
  BRIDGE_SUBJECT: 'trusted-bridge',
};

function caller(claims: Record<string, unknown> = {}) {
  return TestAuth.fromJwtPayload(JSON.stringify({
    iss: bridgeEnv.BRIDGE_ISSUER,
    sub: bridgeEnv.BRIDGE_SUBJECT,
    aud: bridgeEnv.BRIDGE_AUDIENCE,
    ...claims,
  }), new ConnectionId(1n));
}

function testDatabase() {
  const test = createModuleTestHarness(moduleSchema, moduleExports);
  const call = (auth: TestAuth, args: { accountId: string; playerId: string; displayName: string; revision: bigint },
    env = bridgeEnv) =>
    test.withReducerTx(auth, ctx => {
      // The in-memory harness has no database environment setter yet.
      Object.assign(ctx, { env });
      moduleExports.upsertProfile(ctx, args);
    });
  return { test, call };
}

it('accepts writes only from the configured OIDC bridge', () => {
  const { test, call } = testDatabase();
  const args = { accountId: ACCOUNT, playerId: PLAYER, displayName: PLAYER, revision: 1n };
  for (const auth of [
    TestAuth.internal(),
    caller({ iss: 'https://other.example.test' }),
    caller({ aud: 'another-app' }),
    caller({ sub: 'other-service' }),
  ]) {
    expect(() => call(auth, args)).toThrow('Only the MineMine bridge');
  }
  expect(() => call(caller(), args, { ...bridgeEnv, BRIDGE_AUDIENCE: '' }))
    .toThrow('Only the MineMine bridge');
  expect(test.db.playerProfile.count()).toBe(0n);
  expect(test.db.playerDirectory.count()).toBe(0n);
});

it('applies newer profile revisions and tolerates exact replay', () => {
  const { test, call } = testDatabase();
  call(caller(), { accountId: ACCOUNT, playerId: PLAYER, displayName: PLAYER, revision: 1n });
  call(caller(), { accountId: ACCOUNT, playerId: PLAYER, displayName: PLAYER, revision: 1n });
  call(caller(), { accountId: ACCOUNT, playerId: PLAYER, displayName: 'alice.minemine.eth', revision: 2n });
  call(caller(), { accountId: ACCOUNT, playerId: PLAYER, displayName: 'old', revision: 1n });
  expect(test.db.playerProfile.count()).toBe(1n);
  expect(test.db.playerProfile.accountId.find(ACCOUNT)).toMatchObject({
    playerId: PLAYER, displayName: 'alice.minemine.eth', revision: 2n,
  });
  expect(test.db.playerDirectory.count()).toBe(1n);
  expect(test.db.playerDirectory.playerId.find(PLAYER)).toEqual({
    playerId: PLAYER, displayName: 'alice.minemine.eth', revision: 2n,
  });
});

it('keeps a verified ENS display longer than 64 characters intact', () => {
  const { test, call } = testDatabase();
  const longEns = `${'a'.repeat(63)}.${'b'.repeat(63)}.eth`;
  call(caller(), { accountId: ACCOUNT, playerId: PLAYER, displayName: PLAYER, revision: 1n });
  call(caller(), { accountId: ACCOUNT, playerId: PLAYER, displayName: longEns, revision: 2n });
  expect(test.db.playerDirectory.playerId.find(PLAYER)).toMatchObject({ displayName: longEns, revision: 2n });
});

it('rejects conflicting revisions and malformed projections without changing the row', () => {
  const { test, call } = testDatabase();
  call(caller(), { accountId: ACCOUNT, playerId: PLAYER, displayName: PLAYER, revision: 1n });
  for (const args of [
    { accountId: ACCOUNT, playerId: PLAYER, displayName: 'mallory', revision: 1n },
    { accountId: ACCOUNT.toUpperCase(), playerId: PLAYER, displayName: PLAYER, revision: 2n },
    { accountId: ACCOUNT, playerId: 'w_bad', displayName: PLAYER, revision: 2n },
    { accountId: ACCOUNT, playerId: 'w_22222222222222222', displayName: PLAYER, revision: 2n },
    { accountId: ACCOUNT, playerId: PLAYER, displayName: ' alice', revision: 2n },
    { accountId: ACCOUNT, playerId: PLAYER, displayName: ACCOUNT, revision: 2n },
    { accountId: ACCOUNT, playerId: PLAYER, displayName: 'a'.repeat(256), revision: 2n },
    { accountId: ACCOUNT, playerId: PLAYER, displayName: 'bad\nname', revision: 2n },
    { accountId: '0x2222222222222222222222222222222222222222', playerId: PLAYER, displayName: PLAYER, revision: 1n },
  ]) expect(() => call(caller(), args)).toThrow();
  expect(test.db.playerProfile.accountId.find(ACCOUNT)).toMatchObject({
    displayName: PLAYER, revision: 1n,
  });
  expect(test.db.playerDirectory.playerId.find(PLAYER)).toMatchObject({
    displayName: PLAYER, revision: 1n,
  });
});
