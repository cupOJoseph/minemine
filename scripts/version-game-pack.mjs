import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { packGame } from './pack-game.mjs';

export function installVersionedGamePack(engineDir, release, root) {
  const packs = path.join(engineDir, release, 'packs');
  const work = fs.mkdtempSync(path.join(packs, '.game-pack-'));
  try {
    const file = path.join(work, 'minetest.pack');
    const packed = packGame(root, file);
    const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const relative = release + '/packs/' + sha256.slice(0, 16) + '/minetest.pack';
    const target = path.join(engineDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(file, target);
    return { relative, gameCommit: packed.gameCommit, features: { doubleTapSprint: true, dayCommand: true }, asset: { sha256, bytes: packed.bytes } };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
