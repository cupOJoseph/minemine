import { ContractFactory, JsonRpcProvider, Wallet, getAddress, parseUnits } from 'ethers';
import fs from 'node:fs';
import { compileTownBlocks } from './compile-contracts.mjs';

const { RPC_URL, DEPLOYER_PRIVATE_KEY, TOKEN_ADDRESS, TOWN_TREASURY, TOWN_PRICE_PER_BLOCK } = process.env;
if (![RPC_URL, DEPLOYER_PRIVATE_KEY, TOKEN_ADDRESS, TOWN_TREASURY, TOWN_PRICE_PER_BLOCK].every(Boolean)) throw new Error('Set RPC_URL, DEPLOYER_PRIVATE_KEY, TOKEN_ADDRESS, TOWN_TREASURY and TOWN_PRICE_PER_BLOCK.');
const provider = new JsonRpcProvider(RPC_URL);
try {
  const { chainId } = await provider.getNetwork();
  if (![11155111n, 31337n].includes(chainId)) throw new Error('Town deployment is restricted to Sepolia or local chain 31337.');
  const token = getAddress(TOKEN_ADDRESS);
  const treasury = getAddress(TOWN_TREASURY);
  const pricePerBlock = parseUnits(TOWN_PRICE_PER_BLOCK, 18);
  if (pricePerBlock <= 0n) throw new Error('Town price must be positive.');
  const wallet = new Wallet(DEPLOYER_PRIVATE_KEY, provider);
  const artifact = compileTownBlocks();
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, wallet).deploy(token, treasury, pricePerBlock);
  console.log(`Submitted town contract deployment on chain ${chainId}: ${contract.deploymentTransaction().hash}`);
  const receipt = await contract.deploymentTransaction().wait(2);
  const record = { chainId: Number(chainId), address: await contract.getAddress(), token, treasury, pricePerBlock: pricePerBlock.toString(), transactionHash: receipt.hash, blockNumber: receipt.blockNumber, compiler: artifact.compiler };
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(`artifacts/towns-deployment-${chainId}-${record.address}.json`, JSON.stringify(record, null, 2) + '\n');
  console.log(`Confirmed town contract: ${record.address}. Set TOWN_CONTRACT_ADDRESS to this address.`);
} finally { provider.destroy(); }
