import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const binary = path.resolve(process.argv[2] || 'vendor/native/bin/luantiserver');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minemine-treehouses-'));
try {
  const games = path.join(work, 'games');
  fs.mkdirSync(games);
  fs.symlinkSync(path.join(root, 'vendor/game'), path.join(games, 'minetest'), 'dir');
  for (const [biome, chance, expected] of [['taiga', 100, true], ['rainforest', 100, true], ['desert', 100, false], ['taiga', 0, false]]) {
    const world = path.join(work, biome + '-' + chance);
    const mods = path.join(world, 'worldmods');
    fs.mkdirSync(mods, { recursive: true });
    fs.cpSync(path.join(root, 'game/mods/minemine_structures'), path.join(mods, 'minemine_structures'), { recursive: true });
    fs.cpSync(path.join(root, 'test/integration/treehouse_probe'), path.join(mods, 'treehouse_probe'), { recursive: true });
    fs.writeFileSync(path.join(world, 'world.mt'), 'gameid = minetest\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\nload_mod_minemine_structures = true\nload_mod_treehouse_probe = true\n');
    const config = path.join(world, 'test.conf');
    fs.writeFileSync(config, ['bind_address = 127.0.0.1', 'port = ' + (49152 + Math.floor(Math.random() * 16384)),
      'server_announce = false', 'enable_update_checker = false', 'mg_name = flat', 'mg_flags = light, nocaves, nodungeons',
      'mgflat_ground_level = 12', 'fixed_map_seed = 4117', 'minemine_village_chance = 0',
      'minemine_treehouse_chance = ' + chance, 'treehouse_probe_biome = ' + biome, 'treehouse_probe_expected = ' + expected,
    ].join('\n') + '\n');
    const result = spawnSync(binary, ['--world', world, '--config', config, '--logfile', ''], {
      env: { ...process.env, LUANTI_GAME_PATH: games, LUANTI_USER_PATH: path.join(work, 'user') },
      encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) throw result.error;
    const log = result.stdout + result.stderr;
    if (result.status !== 0 || !log.includes('[treehouse_probe] PASS')) throw new Error('Treehouse probe failed:\n' + log);
    console.log(log.split('\n').filter(line => line.includes('[treehouse_probe]')).join('\n'));
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
