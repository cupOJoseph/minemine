import { expect, it } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import moduleSchema, * as moduleExports from './index';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
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
  const call = (auth: TestAuth, args?: { accountId: string; displayName: string; revision: bigint },
    env = bridgeEnv) =>
    test.withReducerTx(auth, ctx => {
      // The in-memory harness has no database environment setter yet.
      Object.assign(ctx, { env });
      if (args) moduleExports.upsertProfile(ctx, args);
      else moduleExports.onConnect(ctx, {});
    });
  return { test, call };
}

it('accepts only the configured OIDC service on connection and reducer calls', () => {
  const { test, call } = testDatabase();
  const args = { accountId: ACCOUNT, displayName: 'alice', revision: 1n };
  expect(() => call(caller())).not.toThrow();
  for (const auth of [
    TestAuth.internal(),
    caller({ iss: 'https://other.example.test' }),
    caller({ aud: 'another-app' }),
    caller({ sub: 'other-service' }),
  ]) {
    expect(() => call(auth)).toThrow('Only the MineMine bridge');
    expect(() => call(auth, args)).toThrow('Only the MineMine bridge');
  }
  expect(() => call(caller(), args, { ...bridgeEnv, BRIDGE_AUDIENCE: '' }))
    .toThrow('Only the MineMine bridge');
  expect(test.db.playerProfile.count()).toBe(0n);
});

it('applies newer profile revisions and tolerates exact replay', () => {
  const { test, call } = testDatabase();
  call(caller(), { accountId: ACCOUNT, displayName: 'alice', revision: 1n });
  call(caller(), { accountId: ACCOUNT, displayName: 'alice', revision: 1n });
  call(caller(), { accountId: ACCOUNT, displayName: 'alice.minemine.eth', revision: 2n });
  call(caller(), { accountId: ACCOUNT, displayName: 'old', revision: 1n });
  expect(test.db.playerProfile.count()).toBe(1n);
  expect(test.db.playerProfile.accountId.find(ACCOUNT)).toMatchObject({
    displayName: 'alice.minemine.eth', revision: 2n,
  });
});

it('rejects conflicting revisions and malformed projections without changing the row', () => {
  const { test, call } = testDatabase();
  call(caller(), { accountId: ACCOUNT, displayName: 'alice', revision: 1n });
  for (const args of [
    { accountId: ACCOUNT, displayName: 'mallory', revision: 1n },
    { accountId: ACCOUNT.toUpperCase(), displayName: 'alice', revision: 2n },
    { accountId: ACCOUNT, displayName: ' alice', revision: 2n },
    { accountId: ACCOUNT, displayName: 'bad\nname', revision: 2n },
  ]) expect(() => call(caller(), args)).toThrow();
  expect(test.db.playerProfile.accountId.find(ACCOUNT)).toMatchObject({
    displayName: 'alice', revision: 1n,
  });
});
