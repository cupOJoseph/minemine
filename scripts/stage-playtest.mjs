import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { packGame } from './pack-game.mjs';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export function releaseId(html) {
  const found = html.match(/src=["']([a-f0-9]{12})\/launcher\.js["']/);
  if (!found) throw new Error('Unrecognized upstream release layout. Inspect build_www.sh before staging.');
  return found[1];
}
export function validateWasm(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(8);
    if (fs.readSync(fd, header, 0, 8, 0) !== 8 || !header.equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw new Error('Missing or invalid WASM binary.');
  } finally { fs.closeSync(fd); }
}
function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
export function stagePlaytest(buildSource, root = project) {
  buildSource = path.resolve(buildSource);
  const output = path.join(root, 'public/engine');
  if (fs.existsSync(output)) throw new Error('public/engine already exists. Archive/review the previous engine before replacing it.');
  const sources = JSON.parse(fs.readFileSync(path.join(root, 'upstream.sources.json'), 'utf8'));
  const profile = JSON.parse(fs.readFileSync(path.join(buildSource, 'miners-build-profile.json'), 'utf8'));
  if (profile.wrapperCommit !== sources.sources.wasm.commit) throw new Error('Build profile does not match the pinned wrapper.');
  const www = path.join(buildSource, 'www');
  const release = releaseId(fs.readFileSync(path.join(www, 'index.html'), 'utf8'));
  for (const file of ['launcher.js', 'worker.js', 'luanti.js', 'luanti.wasm', 'packs/base.pack', 'packs/certs.pack']) {
    const target = path.join(www, release, file);
    if (!fs.statSync(target).isFile() || !fs.statSync(target).size) throw new Error('Missing engine asset: ' + file);
  }
  validateWasm(path.join(www, release, 'luanti.wasm'));
  fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
  const work = fs.mkdtempSync(path.join(root, 'runtime', 'playtest-stage-'));
  const staged = path.join(work, 'engine');
  fs.cpSync(www, staged, { recursive: true });
  const gamePack = path.join(staged, release, 'packs/minetest.pack');
  const packed = packGame(root, gamePack);
  const revision = packed.gameCommit;
  const template = fs.readFileSync(path.join(root, 'playtest/index.html'), 'utf8');
  if (template.split('%__MINERS_RELEASE__%').length !== 2) throw new Error('Playtest template release marker is missing or duplicated.');
  fs.writeFileSync(path.join(staged, 'index.html'), template.replace('%__MINERS_RELEASE__%', release));
  for (const file of ['playtest.js', 'playtest.css', 'session.mjs']) fs.copyFileSync(path.join(root, 'playtest', file), path.join(staged, file));
  const launcherFile = path.join(staged, release, 'launcher.js');
  fs.appendFileSync(launcherFile, '\n// Miners adapter: expose inspected APIs without eval or credential URLs.\nglobalThis.MinersEngine = Object.freeze({ LuantiLauncher, LuantiArgs, onMainStarted(callback) { mtScheduler.addCondition("miners-main-started", callback, ["main_called"]); } });\n');
  const assets = {};
  for (const file of ['launcher.js', 'worker.js', 'luanti.js', 'luanti.wasm', 'packs/base.pack', 'packs/certs.pack', 'packs/minetest.pack']) {
    const target = path.join(staged, release, file);
    assets[release + '/' + file] = { bytes: fs.statSync(target).size, sha256: sha256(target) };
  }
  const build = {
    schema: 1, kind: 'solo-engine-playtest', browserVerified: false,
    builtAt: new Date().toISOString(), release, wrapperCommit: profile.wrapperCommit,
    gameCommit: revision, profile, sources, assets,
    limitations: ['Browser gameplay has not been verified by this build script.', 'No shared server, wallet-gated multiplayer, or token spending.', 'No external network proxy is enabled.'],
  };
  fs.writeFileSync(path.join(staged, 'build.json'), JSON.stringify(build, null, 2) + '\n');
  fs.mkdirSync(path.join(staged, 'notices'), { recursive: true });
  for (const file of ['LICENSE', 'THIRD_PARTY.md']) fs.copyFileSync(path.join(root, file), path.join(staged, 'notices', file));
  fs.copyFileSync(path.join(buildSource, 'build_luanti.sh'), path.join(staged, 'notices', 'build_luanti.sh.txt'));
  fs.copyFileSync(path.join(buildSource, 'LICENSE'), path.join(staged, 'notices', 'wasm-wrapper-LICENSE.txt'));
  fs.copyFileSync(path.join(root, 'vendor/native/LICENSE.txt'), path.join(staged, 'notices', 'engine-LICENSE.txt'));
  const game = path.join(root, 'vendor/game');
  for (const name of fs.readdirSync(game).filter(name => /^licen[cs]e/i.test(name))) {
    const target = path.join(game, name);
    if (fs.statSync(target).isFile()) fs.copyFileSync(target, path.join(staged, 'notices', 'game-' + name));
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.renameSync(staged, output);
  return build;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/stage-playtest.mjs BUILD_SOURCE');
  const build = stagePlaytest(process.argv[2]);
  console.log('Staged engine playtest ' + build.release + '. Browser gameplay still needs verification.');
}
