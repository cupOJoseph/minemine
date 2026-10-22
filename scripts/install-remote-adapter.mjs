import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateWasm } from './stage-playtest.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const engine = path.join(root, 'public/engine');
const build = JSON.parse(fs.readFileSync(path.join(engine, 'build.json'), 'utf8'));
if (build.kind !== 'solo-engine-playtest' || !/^[a-f0-9]{12}$/.test(build.release)) throw new Error('Unrecognized engine build.');
validateWasm(path.join(engine, build.release, 'luanti.wasm'));
for (const [relative, expected] of Object.entries(build.assets)) {
  if (relative.split('/').some(part => !part || part.startsWith('.') || part.includes('\\'))) throw new Error('Invalid engine asset path.');
  const value = fs.readFileSync(path.join(engine, relative));
  if (value.length !== expected.bytes || createHash('sha256').update(value).digest('hex') !== expected.sha256) throw new Error('Engine asset hash mismatch: ' + relative);
}
for (const file of ['adapter.js', 'connect.html', 'remote.js', 'remote-session.mjs', 'log-redaction.mjs']) fs.copyFileSync(path.join(root, 'playtest', file), path.join(engine, file));
console.log('Installed source-matched remote adapter into the verified local engine bundle. Multiplayer remains gated by GAME_ENABLED and ENGINE_ADAPTER_READY.');
