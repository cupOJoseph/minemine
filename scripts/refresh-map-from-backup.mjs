import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const [backupInput = '/srv/minemine/backups', appInput = '/srv/minemine/app'] = process.argv.slice(2);
if (process.argv.length > 4) {
  throw new Error('Usage: node scripts/refresh-map-from-backup.mjs [BACKUP_DIR] [APP_DIR]');
}

const backupDir = await realpath(backupInput);
const appDir = await realpath(appInput);
const mapDir = path.join(appDir, 'public/map');
const archives = (await readdir(backupDir))
  .filter(name => /^minemine-world-\d{8}T\d{6}Z-\d+\.tar\.gz$/.test(name))
  .sort().reverse();
if (archives.length === 0) {
  console.log('No stopped-world backup exists; map refresh skipped.');
  process.exit(0);
}

const archive = path.join(backupDir, archives[0]);
for (const file of [archive, `${archive}.sha256`]) {
  let regular = false;
  try { regular = (await lstat(file)).isFile(); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!regular) throw new Error(`Expected a regular backup file: ${file}`);
}
try {
  const published = JSON.parse(await readFile(path.join(mapDir, 'snapshot.json'), 'utf8'));
  if (published.sourceBackup === archives[0] &&
      /^snapshot-[a-f0-9]{16}\.png$/.test(published.image) &&
      (await lstat(path.join(mapDir, published.image))).isFile()) {
    console.log(`Map is already current for latest backup ${archives[0]}.`);
    process.exit(0);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

execFileSync(process.execPath, [path.join(appDir, 'scripts/publish-map-from-backup.mjs'),
  archive, mapDir, path.join(appDir, 'vendor/mapper/minetestmapper'),
  path.join(appDir, 'vendor/mapper/colors.txt')], { stdio: 'inherit', timeout: 240_000 });
