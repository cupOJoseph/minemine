import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const refresh = new URL('../scripts/refresh-map-from-backup.mjs', import.meta.url).pathname;

test('map refresh uses each new cold backup once and fails closed on a missing sidecar', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'minemine-map-refresh-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backups = path.join(root, 'backups');
  const app = path.join(root, 'app');
  const map = path.join(app, 'public/map');
  mkdirSync(backups);
  mkdirSync(map, { recursive: true });
  mkdirSync(path.join(app, 'scripts'));
  writeFileSync(path.join(app, 'scripts/publish-map-from-backup.mjs'), `
    import fs from 'node:fs';
    import path from 'node:path';
    const [archive, map] = process.argv.slice(2);
    const image = 'snapshot-0123456789abcdef.png';
    fs.writeFileSync(path.join(map, image), 'image');
    fs.writeFileSync(path.join(map, 'snapshot.json'), JSON.stringify({sourceBackup: path.basename(archive), image}));
    fs.appendFileSync(path.join(map, 'runs.txt'), path.basename(archive) + '\\n');
  `);
  const run = () => execFileSync(process.execPath, [refresh, backups, app], { encoding: 'utf8' });
  assert.match(run(), /No stopped-world backup/);
  const first = 'minemine-world-20261102T010000Z-1.tar.gz';
  writeFileSync(path.join(backups, first), 'archive');
  writeFileSync(path.join(backups, first + '.sha256'), 'sidecar');
  run();
  assert.equal(readFileSync(path.join(map, 'runs.txt'), 'utf8'), first + '\n');
  assert.match(run(), /Map is already current/);
  const second = 'minemine-world-20261103T010000Z-2.tar.gz';
  writeFileSync(path.join(backups, second), 'archive');
  assert.throws(run, /Expected a regular backup file/);
  writeFileSync(path.join(backups, second + '.sha256'), 'sidecar');
  run();
  assert.equal(readFileSync(path.join(map, 'runs.txt'), 'utf8'), first + '\n' + second + '\n');
});
