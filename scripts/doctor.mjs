import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
let missing = 0;
for (const [label, command, args] of [['Node', 'node', ['--version']], ['Git', 'git', ['--version']], ['CMake (native/WASM build)', 'cmake', ['--version']], ['Docker (optional hosting)', 'docker', ['--version']], ['GitHub authentication', 'gh', ['auth', 'status']]]) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const ok = result.status === 0;
  console.log(`${ok ? 'OK' : 'MISSING/BLOCKED'}  ${label}`);
  if (!ok) missing++;
}
for (const [label, file] of [['Source lock', 'upstream.sources.json'], ['Engine bundle', 'public/engine/index.html'], ['Wallet engine adapter', 'public/engine/adapter.js']]) {
  let ok = fs.existsSync(file);
  if (label === 'Source lock' && ok) ok = Object.values(JSON.parse(fs.readFileSync(file)).sources).every(s => /^[a-f0-9]{40}$/.test(s.commit || ''));
  console.log(`${ok ? 'OK' : 'MISSING/BLOCKED'}  ${label}`);
  if (!ok) missing++;
}
console.log('Doctor checks availability only; it does not prove engine compatibility or public deployment.');
process.exitCode = missing ? 1 : 0;
