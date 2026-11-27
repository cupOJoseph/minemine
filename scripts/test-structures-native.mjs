import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const binary = path.resolve(process.argv[2] || 'vendor/native/bin/luantiserver');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minemine-structures-'));
try {
  const games = path.join(work, 'games');
  fs.mkdirSync(games);
  fs.symlinkSync(path.join(root, 'vendor/game'), path.join(games, 'minetest'), 'dir');
  for (const [style, chance] of [['desert', 100], ['tundra', 100], ['desert', 0]]) {
    const world = path.join(work, style + '-' + chance);
    const mods = path.join(world, 'worldmods');
    fs.mkdirSync(mods, { recursive: true });
    for (const mod of ['minemine_structures', 'minemine_movement', 'minemine_commands']) {
      fs.cpSync(path.join(root, 'game/mods', mod), path.join(mods, mod), { recursive: true });
    }
    fs.cpSync(path.join(root, 'test/integration/structures_probe'), path.join(mods, 'structures_probe'), { recursive: true });
    fs.writeFileSync(path.join(world, 'world.mt'), 'gameid = minetest\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\nmod_storage_backend = sqlite3\nload_mod_minemine_structures = true\nload_mod_minemine_movement = true\nload_mod_minemine_commands = true\nload_mod_structures_probe = true\n');
    const config = path.join(world, 'test.conf');
    fs.writeFileSync(config, [
      'bind_address = 127.0.0.1', 'port = ' + (49152 + Math.floor(Math.random() * 16384)), 'server_announce = false', 'enable_update_checker = false', 'mg_name = flat',
      'mg_flags = light, nocaves, nodungeons', 'mgflat_ground_level = 12', 'fixed_map_seed = 4117',
      'minemine_structures_workshop = true', 'minemine_village_chance = ' + chance,
      'structures_probe_style = ' + style, 'structures_probe_empty = ' + (chance === 0),
    ].join('\n') + '\n');
    const result = spawnSync(binary, ['--world', world, '--config', config, '--logfile', ''], {
      env: { ...process.env, LUANTI_GAME_PATH: games, LUANTI_USER_PATH: path.join(work, 'user') }, encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) throw result.error;
    const log = result.stdout + result.stderr;
    if (result.status !== 0 || !log.includes('[structures_probe] PASS')) throw new Error('Native probe did not finish:\n' + log);
    console.log(log.split('\n').filter(line => line.includes('[structures_probe]')).join('\n'));
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
