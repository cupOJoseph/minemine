import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installVersionedGamePack } from './version-game-pack.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [source, output] = process.argv.slice(2).map(p => path.resolve(p));
if (!source || !output || fs.existsSync(output)) {
  throw new Error('Usage: node scripts/repack-playtest.mjs EXISTING_ENGINE_DIR NEW_ENGINE_DIR');
}
const build = JSON.parse(fs.readFileSync(path.join(source, 'build.json'), 'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(root, 'upstream.sources.json'), 'utf8'));
if (build.kind !== 'solo-engine-playtest' || !/^[a-f0-9]{12}$/.test(build.release) ||
    build.wrapperCommit !== sources.sources.wasm.commit || build.gameCommit !== sources.sources.game.commit) {
  throw new Error('Engine bundle differs from the source lock.');
}
for (const [relative, expected] of Object.entries(build.assets)) {
  if (relative.split('/').some(segment => !segment || segment.startsWith('.') || segment.includes('\\'))) {
    throw new Error('Invalid bundle path.');
  }
  const buffer = fs.readFileSync(path.join(source, relative));
  if (buffer.length !== expected.bytes || createHash('sha256').update(buffer).digest('hex') !== expected.sha256) {
    throw new Error('Bundle asset differs from its manifest: ' + relative);
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const temporary = fs.mkdtempSync(path.join(path.dirname(output), 'engine-repack-'));
try {
  const stage = path.join(temporary, 'engine');
  fs.cpSync(source, stage, { recursive: true });
  const packed = installVersionedGamePack(stage, build.release, root);
  const oldPack = build.gamePack ?? build.release + '/packs/minetest.pack';
  if (oldPack !== packed.relative && /^[a-f0-9]{12}\/packs\/(?:[a-f0-9]{16}\/)?minetest\.pack$/.test(oldPack)) {
    fs.rmSync(path.join(stage, oldPack), { force: true });
    delete build.assets[oldPack];
  }
  build.gamePack = packed.relative;
  build.assets[packed.relative] = packed.asset;
  build.browserVerified = false;
  build.builtAt = new Date().toISOString();
  for (const file of ['playtest.js', 'playtest.css', 'diagnostics.css', 'session.mjs', 'game-pack.mjs',
    'adapter.js', 'connect.html', 'remote.js', 'remote-session.mjs']) {
    fs.copyFileSync(path.join(root, 'playtest', file), path.join(stage, file));
  }
  const template = fs.readFileSync(path.join(root, 'playtest/index.html'), 'utf8');
  fs.writeFileSync(path.join(stage, 'index.html'), template.replace('%__MINERS_RELEASE__%', build.release));
  fs.writeFileSync(path.join(stage, 'build.json'), JSON.stringify(build, null, 2) + '\n');
  fs.renameSync(stage, output);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('Repacked pinned engine with game content: ' + build.gamePack);
