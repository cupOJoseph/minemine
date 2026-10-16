import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { createAuth, playerName } from '../server/auth.mjs';
import { readConfig } from '../server/config.mjs';
const wallet = new Wallet('0x' + '11'.repeat(32)); // Public test fixture, never funded.
const other = new Wallet('0x' + '22'.repeat(32));
const options = { origin: 'https://miners.example', chainId: 11155111 };

test('SIWE signature creates an address-bound session and cannot be replayed', async () => {
  const auth = createAuth(options);
  const challenge = auth.issue(wallet.address, options.chainId);
  assert.match(challenge.message, /^https:\/\/miners\.example wants you to sign in/);
  assert.match(challenge.message, /Chain ID: 11155111/);
  const signature = await wallet.signMessage(challenge.message);
  const login = auth.verify(challenge.token, signature);
  assert.equal(auth.get(login.token).address, wallet.address);
  assert.match(login.session.playerName, /^w_[0-9a-f]{18}$/);
  assert.throws(() => auth.verify(challenge.token, signature), /expired or already used/);
  auth.revoke(login.token);
  assert.equal(auth.get(login.token), undefined);
});
test('wrong signer and modified domain are rejected and consume challenges', async () => {
  const auth = createAuth(options);
  const challenge = auth.issue(wallet.address, options.chainId);
  assert.throws(() => auth.verify(challenge.token, other.signingKey.sign('0x' + '00'.repeat(32)).serialized), /Signature does not match|Invalid wallet signature/);
  assert.throws(() => auth.verify(challenge.token, '0x'), /expired or already used/);
  const second = auth.issue(wallet.address, options.chainId);
  const signature = await wallet.signMessage(second.message.replace('miners.example', 'attacker.example'));
  assert.throws(() => auth.verify(second.token, signature), /does not match/);
});
test('a signature cannot be paired with another browser challenge', async () => {
  const auth = createAuth(options);
  const first = auth.issue(wallet.address, options.chainId);
  const second = auth.issue(wallet.address, options.chainId);
  const signature = await wallet.signMessage(first.message);
  assert.throws(() => auth.verify(second.token, signature), /does not match/);
  assert.throws(() => auth.verify(undefined, signature), /expired or already used/);
});
test('challenges and sessions expire and old challenge is replaced', async () => {
  let now = 1_800_000_000_000;
  const auth = createAuth({ ...options, now: () => now });
  const initial = auth.issue(wallet.address, options.chainId);
  const replacement = auth.issue(wallet.address, options.chainId, initial.token);
  assert.throws(() => auth.verify(initial.token, '0x'), /expired or already used/);
  now += 300_001;
  assert.throws(() => auth.verify(replacement.token, '0x'), /expired or already used/);
  const challenge = auth.issue(wallet.address, options.chainId);
  const session = auth.verify(challenge.token, await wallet.signMessage(challenge.message));
  now += 12 * 60 * 60_000;
  assert.equal(auth.get(session.token), undefined);
});
test('bad addresses, wrong chains, and challenge floods are rejected', () => {
  const auth = createAuth({ ...options, capacity: 1 });
  assert.throws(() => auth.issue('not an address', options.chainId), /Invalid Ethereum/);
  assert.throws(() => auth.issue(wallet.address, 1), /configured test network/);
  auth.issue(wallet.address, options.chainId);
  assert.throws(() => auth.issue(other.address, options.chainId), /capacity/);
});
test('player identity is stable across address casing', () => {
  assert.equal(playerName(wallet.address), playerName(wallet.address.toLowerCase()));
  assert.notEqual(playerName(wallet.address), playerName(other.address));
});
test('configuration requires TLS for public hosts and restricts initial chains', () => {
  assert.throws(() => readConfig({ PUBLIC_ORIGIN: 'http://game.example' }), /HTTPS/);
  assert.throws(() => readConfig({ PUBLIC_ORIGIN: 'https://game.example/path' }), /without path/);
  assert.throws(() => readConfig({ CHAIN_ID: '1' }), /Sepolia/);
  assert.throws(() => readConfig({ PORT: '-1' }), /port/);
  assert.equal(readConfig({}).origin, 'http://localhost:3000');
});
