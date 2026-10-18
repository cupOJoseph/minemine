import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateWasm } from './stage-playtest.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const preflight = process.argv.includes('--preflight');
const target = path.join(root, 'runtime/pages-site');
if (fs.existsSync(target)) throw new Error('Pages staging already exists; review it before replacing.');
fs.mkdirSync(target, { recursive: true });
const hosting = path.join(root, 'playtest/hosting');
const worker = fs.readFileSync(path.join(hosting, 'coi-serviceworker.js'));
if (createHash('sha256').update(worker).digest('hex') !== 'e97bbac6017322d48aa54a5bc7ce473c725a4b7376ff245002e0ba71c3dcdd7e') throw new Error('Hosting dependency differs from the reviewed source.');
if (!preflight) {
  const engine = path.join(root, 'public/engine');
  const build = JSON.parse(fs.readFileSync(path.join(engine, 'build.json'), 'utf8'));
  if (build.kind !== 'solo-engine-playtest' || !/^[a-f0-9]{12}$/.test(build.release)) throw new Error('Unrecognized engine bundle.');
  validateWasm(path.join(engine, build.release, 'luanti.wasm'));
  for (const [relative, expected] of Object.entries(build.assets)) {
    if (relative.split('/').some(part => !part || part.startsWith('.') || part.includes('\\'))) throw new Error('Invalid engine asset path.');
    const asset = fs.readFileSync(path.join(engine, relative));
    if (asset.length !== expected.bytes || createHash('sha256').update(asset).digest('hex') !== expected.sha256) throw new Error('Engine asset hash mismatch: ' + relative);
  }
  fs.cpSync(engine, target, { recursive: true, filter: file => !path.relative(engine, file).split(path.sep).some(part => part.startsWith('.')) });
  const index = path.join(target, 'index.html');
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<head>', '<head>\n<script src="isolation-config.js"></script><script src="coi-serviceworker.js"></script>'));
}
for (const file of fs.readdirSync(hosting)) fs.copyFileSync(path.join(hosting, file), path.join(target, file));
fs.copyFileSync(path.join(root, 'playtest/playtest.css'), path.join(target, 'playtest.css'));
if (preflight) fs.copyFileSync(path.join(hosting, 'compatibility.html'), path.join(target, 'index.html'));
fs.writeFileSync(path.join(target, '.nojekyll'), '');
console.log('Prepared ' + (preflight ? 'browser prerequisite check' : 'solo engine bundle') + ' at ' + target);
