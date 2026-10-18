import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

export function packGame(root = project, outputFile = path.join(root, 'runtime/minetest.pack')) {
  const sources = JSON.parse(fs.readFileSync(path.join(root, 'upstream.sources.json'), 'utf8'));
  const game = path.join(root, 'vendor/game');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: game, encoding: 'utf8' }).trim();
  if (revision !== sources.sources.game.commit) throw new Error('Game checkout differs from the source lock.');
  if (execFileSync('git', ['status', '--porcelain'], { cwd: game, encoding: 'utf8' }).trim()) throw new Error('Game checkout contains local changes; refusing to bundle unreviewed files.');
  if (fs.existsSync(outputFile)) throw new Error('Game pack already exists. Review/archive it before replacing it.');
  fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
  const work = fs.mkdtempSync(path.join(root, 'runtime', 'game-pack-'));
  const packRoot = path.join(work, 'pack');
  const bundledGame = path.join(packRoot, 'luanti/games/minetest');
  fs.mkdirSync(bundledGame, { recursive: true });
  // Archive only committed game files; never copy its .git, ignored files or credentials.
  const archive = execFileSync('git', ['archive', '--format=tar', revision], { cwd: game, maxBuffer: 128 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', bundledGame], { input: archive });
  fs.cpSync(path.join(root, 'playtest/initial-stuff'), path.join(bundledGame, 'mods/miners_playtest'), { recursive: true });
  const world = path.join(packRoot, 'luanti/worlds/miners-playtest');
  fs.mkdirSync(world, { recursive: true });
  fs.writeFileSync(path.join(world, 'world.mt'), 'gameid = minetest\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\ncreative_mode = true\nenable_damage = false\nload_mod_miners_playtest = true\n');
  const tarFile = path.join(work, 'minetest.tar');
  execFileSync('tar', ['-cf', tarFile, '-C', packRoot, '.']);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  execFileSync('zstd', ['-q', '-T2', '-10', tarFile, '-o', outputFile], { stdio: 'inherit' });
  return { path: outputFile, gameCommit: revision, bytes: fs.statSync(outputFile).size };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(packGame()));
