import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export function compile() {
  const input = {
    language: 'Solidity',
    sources: { 'MineToken.sol': { content: fs.readFileSync(path.join(root, 'contracts/MineToken.sol'), 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import(name) {
    if (!name.startsWith('@openzeppelin/contracts/') || name.includes('..')) return { error: 'Import not allowed' };
    try { return { contents: fs.readFileSync(path.join(root, 'node_modules', name), 'utf8') }; } catch { return { error: `Missing import: ${name}` }; }
  } }));
  const errors = (output.errors || []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  const contract = output.contracts['MineToken.sol'].MineToken;
  return { contractName: 'MineToken', compiler: solc.version(), abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`, deployedBytecode: `0x${contract.evm.deployedBytecode.object}` };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifact = compile();
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/MineToken.json'), JSON.stringify(artifact, null, 2) + '\n');
  console.log(`Compiled MineToken with ${artifact.compiler} (${(artifact.bytecode.length - 2) / 2} bytes creation code).`);
}
