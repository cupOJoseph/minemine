import { writeFileSync } from 'node:fs';
import { ContractFactory, JsonRpcProvider, Wallet, parseEther, parseUnits } from 'ethers';
import { compile, compileTownBlocks } from './compile-contracts.mjs';

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/ci-deploy-economy.mjs OUTPUT_ENV_FILE');
const rpcUrl = 'http://127.0.0.1:8545';
const provider = new JsonRpcProvider(rpcUrl);
try {
  if ((await provider.getNetwork()).chainId !== 31337n) throw new Error('CI Anvil must use chain 31337.');
  const treasury = await provider.getSigner(0);
  const treasuryAddress = await treasury.getAddress();
  const tokenBuild = compile();
  const token = await new ContractFactory(tokenBuild.abi, tokenBuild.bytecode, treasury).deploy(treasuryAddress);
  await token.waitForDeployment();
  const townBuild = compileTownBlocks();
  const town = await new ContractFactory(townBuild.abi, townBuild.bytecode, treasury)
    .deploy(await token.getAddress(), treasuryAddress, parseUnits('1', 18));
  await town.waitForDeployment();
  for (const byte of ['12', '13']) {
    const address = new Wallet('0x' + byte.repeat(32)).address;
    await (await treasury.sendTransaction({ to: address, value: parseEther('1') })).wait();
    await (await token.transfer(address, parseUnits('100', 18))).wait();
  }
  writeFileSync(output, [
    'CHAIN_ID=31337',
    `RPC_URL=${rpcUrl}`,
    `TOKEN_ADDRESS=${await token.getAddress()}`,
    `TOWN_CONTRACT_ADDRESS=${await town.getAddress()}`,
    'TOWN_CONFIRMATIONS=0',
    '',
  ].join('\n'), { mode: 0o600, flag: 'wx' });
  console.log('CI MINE and TownBlocks contracts funded both test wallets on local Anvil.');
} finally {
  provider.destroy();
}
