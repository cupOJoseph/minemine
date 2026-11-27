import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const binary = path.resolve(process.argv[2] || 'vendor/native/bin/luantiserver');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minemine-sugarcane-'));
try {
  const games = path.join(work, 'games'), world = path.join(work, 'world'), mods = path.join(world, 'worldmods');
  fs.mkdirSync(games);
  fs.symlinkSync(path.join(root, 'vendor/game'), path.join(games, 'minetest'), 'dir');
  fs.mkdirSync(mods, { recursive: true });
  fs.cpSync(path.join(root, 'game/mods/minemine_sugarcane'), path.join(mods, 'minemine_sugarcane'), { recursive: true });
  fs.cpSync(path.join(root, 'test/integration/sugarcane_probe'), path.join(mods, 'sugarcane_probe'), { recursive: true });
  fs.writeFileSync(path.join(world, 'world.mt'), 'gameid = minetest\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\nload_mod_minemine_sugarcane = true\nload_mod_sugarcane_probe = true\n');
  const config = path.join(work, 'test.conf');
  fs.writeFileSync(config, 'bind_address = 127.0.0.1\nport = ' + (49152 + Math.floor(Math.random() * 16384)) + '\nserver_announce = false\n');
  const result = spawnSync(binary, ['--world', world, '--config', config, '--logfile', ''], {
    env: { ...process.env, LUANTI_GAME_PATH: games, LUANTI_USER_PATH: path.join(work, 'user') },
    encoding: 'utf8', timeout: 30000,
  });
  if (result.error) throw result.error;
  const log = result.stdout + result.stderr;
  if (result.status !== 0 || !log.includes('[sugarcane_probe] PASS')) throw new Error('Sugarcane probe failed:\n' + log);
  console.log(log.split('\n').filter(line => line.includes('[sugarcane_probe]')).join('\n'));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
