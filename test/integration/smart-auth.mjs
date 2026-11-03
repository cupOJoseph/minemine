import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { ContractFactory, JsonRpcProvider, Wallet, getCreate2Address, keccak256 } from 'ethers';
import { serializeErc6492Signature } from 'viem';
import solc from 'solc';
import { createApp } from '../../server/app.mjs';
import { createAuth } from '../../server/auth.mjs';
import { readConfig } from '../../server/config.mjs';
import { send } from '../helpers/http.mjs';

const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
contract Mock1271 {
    address public immutable owner;
    constructor(address owner_) { owner = owner_; }
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        if (signature.length != 65) return 0xffffffff;
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        return ecrecover(hash, v, r, s) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
contract MockFactory {
    function deploy(address owner, bytes32 salt) external returns (address) {
        return address(new Mock1271{salt: salt}(owner));
    }
}`;

function compile(name) {
  const input = { language: 'Solidity', sources: { 'Mock.sol': { content: source } }, settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  const contract = output.contracts['Mock.sol'][name];
  return { abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object };
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('SIWE accepts deployed ERC-1271 and predeployed ERC-6492 signatures only on its configured chain', { timeout: 40_000 }, async t => {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/@foundry-rs/anvil/bin.mjs', import.meta.url)),
    '--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--accounts', '2', '--no-cors'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  anvil.stderr.resume();
  let processError;
  anvil.on('error', error => { processError = error; });
  const worldDir = mkdtempSync(path.join(tmpdir(), 'minemine-smart-auth-'));
  let provider, app;
  t.after(async () => {
    if (app?.listening) await new Promise(resolve => app.close(resolve));
    provider?.destroy();
    if (anvil.exitCode === null && anvil.signalCode === null) {
      const exited = once(anvil, 'exit');
      anvil.kill('SIGTERM');
      await exited;
    }
    rmSync(worldDir, { recursive: true, force: true });
  });
  const deadline = Date.now() + 10_000;
  while (true) {
    if (processError) throw processError;
    if (anvil.exitCode !== null) throw new Error('Anvil exited before RPC readiness.');
    try {
      const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(500) });
      assert.equal((await response.json()).result, '0x7a69');
      break;
    } catch (error) { if (Date.now() >= deadline) throw error; await pause(50); }
  }
  provider = new JsonRpcProvider(rpcUrl);
  const deployer = await provider.getSigner(0);
  const owner = new Wallet('0x' + '33'.repeat(32)); // Public, unfunded test signer.
  const attacker = new Wallet('0x' + '44'.repeat(32));
  const walletBuild = compile('Mock1271');
  const walletFactory = new ContractFactory(walletBuild.abi, walletBuild.bytecode, deployer);
  const deployed = await walletFactory.deploy(owner.address);
  await deployed.waitForDeployment();
  const factoryBuild = compile('MockFactory');
  const factory = await new ContractFactory(factoryBuild.abi, factoryBuild.bytecode, deployer).deploy();
  await factory.waitForDeployment();
  const salt = '0x' + '55'.repeat(32);
  const initCode = (await walletFactory.getDeployTransaction(owner.address)).data;
  const counterfactual = getCreate2Address(await factory.getAddress(), salt, keccak256(initCode));
  assert.equal(await provider.getCode(counterfactual), '0x');

  const webPort = await freePort();
  const origin = `http://127.0.0.1:${webPort}`;
  app = createApp(readConfig({ PUBLIC_ORIGIN: origin, PORT: String(webPort), CHAIN_ID: '31337', RPC_URL: rpcUrl, WORLD_DIR: worldDir }));
  app.listen(webPort, '127.0.0.1');
  await once(app, 'listening');
  const post = (route, data, cookie) => send(origin + route, { method: 'POST',
    headers: { Host: new URL(origin).host, Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(data) });
  const challengeFor = async address => {
    const response = await post('/api/auth/challenge', { address, chainId: 31337 });
    assert.equal(response.status, 200);
    return { challenge: response.json(), cookie: response.headers['set-cookie'][0].split(';')[0] };
  };

  const direct = await challengeFor(owner.address);
  assert.equal((await post('/api/auth/verify', { signature: await owner.signMessage(direct.challenge.message) }, direct.cookie)).status, 200);

  const denied = await challengeFor(await deployed.getAddress());
  assert.equal((await post('/api/auth/verify', { signature: await attacker.signMessage(denied.challenge.message) }, denied.cookie)).status, 401);
  const deployedChallenge = await challengeFor(await deployed.getAddress());
  const deployedSignature = await owner.signMessage(deployedChallenge.challenge.message);
  const deployedLogin = await post('/api/auth/verify', { signature: deployedSignature }, deployedChallenge.cookie);
  assert.equal(deployedLogin.status, 200, deployedLogin.text);
  assert.equal(deployedLogin.json().address, await deployed.getAddress());
  assert.equal((await post('/api/auth/verify', { signature: deployedSignature }, deployedChallenge.cookie)).status, 401);

  const deniedPending = await challengeFor(counterfactual);
  const badWrapped = serializeErc6492Signature({ address: await factory.getAddress(),
    data: factory.interface.encodeFunctionData('deploy', [owner.address, salt]),
    signature: await attacker.signMessage(deniedPending.challenge.message) });
  assert.equal((await post('/api/auth/verify', { signature: badWrapped }, deniedPending.cookie)).status, 401);
  assert.equal(await provider.getCode(counterfactual), '0x');
  const pending = await challengeFor(counterfactual);
  const rawSignature = await owner.signMessage(pending.challenge.message);
  const wrapped = serializeErc6492Signature({ address: await factory.getAddress(),
    data: factory.interface.encodeFunctionData('deploy', [owner.address, salt]), signature: rawSignature });
  const pendingLogin = await post('/api/auth/verify', { signature: wrapped }, pending.cookie);
  assert.equal(pendingLogin.status, 200, pendingLogin.text);
  assert.equal(pendingLogin.json().address, counterfactual);
  assert.equal(await provider.getCode(counterfactual), '0x', 'verification must not deploy the smart wallet');
  assert.equal((await post('/api/auth/verify', { signature: wrapped }, pending.cookie)).status, 401);

  const wrongChain = createAuth({ origin, chainId: 11155111, rpcUrl });
  const wrongChallenge = wrongChain.issue(await deployed.getAddress(), 11155111);
  await assert.rejects(wrongChain.verify(wrongChallenge.token, await owner.signMessage(wrongChallenge.message)), error => error.status === 503);
});
