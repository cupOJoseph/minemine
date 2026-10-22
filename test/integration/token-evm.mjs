import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { ContractFactory, Interface, JsonRpcProvider, ZeroAddress, parseUnits } from 'ethers';
import { compile, compileTownBlocks } from '../../scripts/compile-contracts.mjs';
import { createApp } from '../../server/app.mjs';
import { readConfig } from '../../server/config.mjs';
import { send } from '../helpers/http.mjs';

test('MINE executes supply, transfer, allowance and burn rules in a local EVM', { timeout: 30_000 }, async t => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const anvil = spawn(process.execPath, [
    fileURLToPath(new URL('../../node_modules/@foundry-rs/anvil/bin.mjs', import.meta.url)),
    '--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--accounts', '3', '--no-cors',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let processError;
  anvil.on('error', error => { processError = error; });
  // Consume output without printing generated development account information.
  anvil.stderr.resume();
  let provider;
  t.after(async () => {
    provider?.destroy();
    if (anvil.exitCode === null && anvil.signalCode === null) {
      const exited = once(anvil, 'exit');
      anvil.kill('SIGTERM');
      await exited;
    }
  });
  const url = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 10_000;
  while (true) {
    if (processError) throw processError;
    if (anvil.exitCode !== null) throw new Error('Local Anvil process exited before RPC readiness.');
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(500) });
      assert.equal((await response.json()).result, '0x7a69');
      break;
    } catch (error) { if (Date.now() >= deadline) throw error; await pause(50); }
  }
  provider = new JsonRpcProvider(url);
  provider.pollingInterval = 50;
  assert.equal((await provider.getNetwork()).chainId, 31337n);
  const treasury = await provider.getSigner(0);
  const spender = await provider.getSigner(1);
  const recipient = await provider.getSigner(2);
  const treasuryAddress = await treasury.getAddress();
  const spenderAddress = await spender.getAddress();
  const recipientAddress = await recipient.getAddress();
  const artifact = compile();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, treasury);
  const rejected = { code: 'CALL_EXCEPTION' };

  await t.test('constructor rejects zero treasury and creates the fixed supply', async () => {
    await assert.rejects(factory.deploy(ZeroAddress), rejected);
  });
  const token = await factory.deploy(treasuryAddress);
  await token.waitForDeployment();
  const units = value => parseUnits(String(value), 18);
  const supply = units(1_000_000);
  await t.test('treasury receives all tokens with the intended metadata', async () => {
    assert.equal(await token.name(), 'MineMine Credit');
    assert.equal(await token.symbol(), 'MINE');
    assert.equal(await token.decimals(), 18n);
    assert.equal(await token.totalSupply(), supply);
    assert.equal(await token.balanceOf(treasuryAddress), supply);
    assert.equal(await token.balanceOf(spenderAddress), 0n);
  });
  await t.test('transfers preserve supply and reject overdrafts and zero recipients', async () => {
    await (await token.transfer(spenderAddress, units(100))).wait();
    assert.equal(await token.balanceOf(spenderAddress), units(100));
    assert.equal(await token.balanceOf(treasuryAddress), supply - units(100));
    assert.equal(await token.totalSupply(), supply);
    await assert.rejects(token.connect(spender).transfer.staticCall(recipientAddress, units(101)), rejected);
    await assert.rejects(token.transfer.staticCall(ZeroAddress, 1n), rejected);
  });
  await t.test('delegated transfers consume allowances and reject unauthorized spending', async () => {
    await (await token.approve(spenderAddress, units(50))).wait();
    await (await token.connect(spender).transferFrom(treasuryAddress, recipientAddress, units(20))).wait();
    assert.equal(await token.balanceOf(recipientAddress), units(20));
    assert.equal(await token.allowance(treasuryAddress, spenderAddress), units(30));
    await assert.rejects(token.connect(spender).transferFrom.staticCall(treasuryAddress, recipientAddress, units(31)), rejected);
    await assert.rejects(token.connect(recipient).transferFrom.staticCall(treasuryAddress, recipientAddress, 1n), rejected);
    await assert.rejects(token.approve.staticCall(ZeroAddress, 1n), rejected);
  });
  await t.test('burns reduce supply; delegated burns require and consume approval', async () => {
    await (await token.burn(units(5))).wait();
    await (await token.connect(spender).burnFrom(treasuryAddress, units(10))).wait();
    assert.equal(await token.totalSupply(), supply - units(15));
    assert.equal(await token.balanceOf(treasuryAddress), supply - units(135));
    assert.equal(await token.allowance(treasuryAddress, spenderAddress), units(20));
    await assert.rejects(token.connect(spender).burn.staticCall(units(101)), rejected);
    await assert.rejects(token.connect(spender).burnFrom.staticCall(treasuryAddress, units(21)), rejected);
    await assert.rejects(token.connect(recipient).burnFrom.staticCall(treasuryAddress, 1n), rejected);
    const mint = new Interface(['function mint(address,uint256)']);
    await assert.rejects(provider.call({ to: await token.getAddress(), data: mint.encodeFunctionData('mint', [treasuryAddress, 1n]) }), rejected);
    assert.equal(await token.totalSupply(), supply - units(15));
  });
  const townArtifact = compileTownBlocks();
  const town = await new ContractFactory(townArtifact.abi, townArtifact.bytecode, treasury).deploy(await token.getAddress(), treasuryAddress, units(2));
  await town.waitForDeployment();
  await t.test('town purchases transfer exact MINE and increment only the buyer quota', async () => {
    assert.equal(await town.pricePerBlock(), units(2));
    await (await token.connect(spender).approve(await town.getAddress(), units(30))).wait();
    const before = await token.balanceOf(treasuryAddress);
    await (await town.connect(spender).buyBlocks(12)).wait();
    assert.equal(await town.purchased(spenderAddress), 12n);
    assert.equal(await town.purchased(recipientAddress), 0n);
    assert.equal(await token.balanceOf(treasuryAddress), before + units(24));
    assert.equal(await token.allowance(spenderAddress, await town.getAddress()), units(6));
    await assert.rejects(town.connect(spender).buyBlocks.staticCall(0), rejected);
    await assert.rejects(town.connect(spender).buyBlocks.staticCall(4097), rejected);
    await assert.rejects(town.connect(recipient).buyBlocks.staticCall(1), rejected);
    await (await token.approve(await town.getAddress(), units(6))).wait();
    await (await town.buyBlocks(3)).wait();
  });
  for (const chainId of [31337, 11155111]) await t.test('authenticated balance API ' + (chainId === 31337 ? 'reads the deployed contract' : 'rejects an RPC on the wrong chain'), async () => {
    const worldDir = mkdtempSync(path.join(tmpdir(), 'miners-evm-world-'));
    const config = readConfig({ CHAIN_ID: String(chainId), RPC_URL: url, TOKEN_ADDRESS: await token.getAddress(), TOWN_CONTRACT_ADDRESS: await town.getAddress(), TOWN_CONFIRMATIONS: chainId === 31337 ? '0' : '6', WORLD_DIR: worldDir });
    const server = createApp(config);
    server.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const appUrl = 'http://127.0.0.1:' + server.address().port;
      const headers = { Host: 'localhost:3000', Origin: config.origin, 'Content-Type': 'application/json' };
      const deniedSync = await send(appUrl + '/api/currency/sync', { method: 'POST', headers, body: '{}' });
      assert.equal(deniedSync.status, 401);
      const challengeResponse = await send(appUrl + '/api/auth/challenge', { method: 'POST', headers, body: JSON.stringify({ address: treasuryAddress, chainId }) });
      assert.equal(challengeResponse.status, 200);
      const signature = await treasury.signMessage(challengeResponse.json().message);
      const verified = await send(appUrl + '/api/auth/verify', { method: 'POST', headers: { ...headers, Cookie: challengeResponse.headers['set-cookie'][0].split(';')[0] }, body: JSON.stringify({ signature }) });
      assert.equal(verified.status, 200);
      const response = await send(appUrl + '/api/currency/balance', { headers: { ...headers, Cookie: verified.headers['set-cookie'][0].split(';')[0] } });
      const cookie = verified.headers['set-cookie'][0].split(';')[0];
      const syncBalance = await send(appUrl + '/api/currency/sync', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}' });
      const name = verified.json().playerName;
      const snapshotPath = path.join(worldDir, 'wallet_balances', name + '.json');
      if (chainId !== 31337) {
        assert.equal(response.status, 503);
        assert.match(response.json().error, /wrong chain/);
        assert.equal(syncBalance.status, 503);
        assert.equal(existsSync(snapshotPath), false);
      } else {
        assert.equal(response.status, 200);
        const value = response.json();
        assert.equal(value.configured, true);
        assert.equal(value.chainId, chainId);
        assert.equal(value.raw, (supply - units(111)).toString());
        assert.equal(value.formatted, '999889.0');
        assert.equal(value.decimals, 18);
        assert.ok(value.blockNumber > 0);
        assert.ok(Date.parse(value.observedAt));
        assert.equal(syncBalance.status, 200);
        const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
        assert.equal(snapshot.name, name);
        assert.equal(snapshot.address, treasuryAddress);
        assert.equal(snapshot.token, await token.getAddress());
        assert.equal(snapshot.raw, value.raw);
        assert.equal(snapshot.formatted, value.formatted);
        assert.equal(snapshot.chain_id, chainId);
        assert.equal(snapshot.block_number, syncBalance.json().blockNumber);
        assert.ok(snapshot.expires_at > Math.floor(Date.now() / 1000));
        assert.equal(statSync(snapshotPath).mode & 0o777, 0o600);
        const townStatus = await send(appUrl + '/api/towns/status', { headers: { ...headers, Cookie: cookie } });
        assert.equal(townStatus.status, 200);
        assert.equal(townStatus.json().purchasedBlocks, 3);
        const synced = await send(appUrl + '/api/towns/sync', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}' });
        assert.equal(synced.status, 200);
        const quota = JSON.parse(readFileSync(path.join(worldDir, 'town_quotas', name + '.json'), 'utf8'));
        assert.equal(quota.blocks, 3);
        assert.equal(quota.address, treasuryAddress);
      }
    } finally {
      await new Promise(resolve => server.close(resolve));
      rmSync(worldDir, { recursive: true, force: true });
    }
  });
});
