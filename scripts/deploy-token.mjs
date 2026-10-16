import { ContractFactory, JsonRpcProvider, Wallet, getAddress } from 'ethers';
import fs from 'node:fs';
import { compile } from './compile-contracts.mjs';
const { RPC_URL, DEPLOYER_PRIVATE_KEY, TOKEN_TREASURY } = process.env;
if (!RPC_URL || !DEPLOYER_PRIVATE_KEY || !TOKEN_TREASURY) throw new Error('Set RPC_URL, DEPLOYER_PRIVATE_KEY and TOKEN_TREASURY for a testnet deployment.');
const provider = new JsonRpcProvider(RPC_URL);
try {
  const { chainId } = await provider.getNetwork();
  if (![11155111n, 31337n].includes(chainId)) throw new Error('Deployment is restricted to Sepolia or local chain 31337.');
  const wallet = new Wallet(DEPLOYER_PRIVATE_KEY, provider);
  const treasury = getAddress(TOKEN_TREASURY);
  const artifact = compile();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log(`Deploying MINE on chain ${chainId}; treasury ${treasury}.`);
  const token = await factory.deploy(treasury);
  console.log(`Submitted deployment: ${token.deploymentTransaction().hash}`);
  const receipt = await token.deploymentTransaction().wait(2);
  const record = { chainId: Number(chainId), address: await token.getAddress(), treasury, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, compiler: artifact.compiler };
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(`artifacts/deployment-${chainId}-${record.address}.json`, JSON.stringify(record, null, 2) + '\n');
  console.log(`Confirmed token: ${record.address}. Set TOKEN_ADDRESS to this address.`);
} finally { provider.destroy(); }
