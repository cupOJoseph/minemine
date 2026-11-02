import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateClaims } from '../public/map/claims.mjs';

const execFile = promisify(execFileCallback);
const [archiveInput, mapDirInput, mapperInput, colorsInput] = process.argv.slice(2);
if (!archiveInput || !mapDirInput || !mapperInput || !colorsInput || process.argv.length !== 6) {
  throw new Error('Usage: node scripts/publish-map-from-backup.mjs BACKUP.tar.gz PUBLIC_MAP_DIR MAPPER_BIN COLORS.txt');
}

const archive = await realpath(archiveInput);
const mapDir = await realpath(mapDirInput);
const mapper = await realpath(mapperInput);
const colors = await realpath(colorsInput);
const stamp = /^minemine-world-(\d{8})T(\d{6})Z-\d+\.tar\.gz$/.exec(path.basename(archive));
if (!stamp) throw new Error('Expected a MineMine stopped-world backup archive.');
const capturedAt = `${stamp[1].slice(0, 4)}-${stamp[1].slice(4, 6)}-${stamp[1].slice(6, 8)}T${stamp[2].slice(0, 2)}:${stamp[2].slice(2, 4)}:${stamp[2].slice(4, 6)}.000Z`;
if (new Date(capturedAt).toISOString() !== capturedAt) throw new Error('Backup capture time is invalid.');
if (!(await lstat(mapDir)).isDirectory() || !(await lstat(mapper)).isFile() || !(await lstat(colors)).isFile()) {
  throw new Error('Expected a map directory, mapper binary and colors file.');
}
if (!(await lstat(path.join(mapDir, 'index.html'))).isFile()) throw new Error('Expected the MineMine map page in the output directory.');

const sidecar = await readFile(archive + '.sha256', 'utf8');
const expected = /^([a-f0-9]{64})  ([^\n]+)\n?$/.exec(sidecar);
if (!expected || expected[2] !== path.basename(archive)) throw new Error('Backup checksum sidecar is invalid.');
const digest = createHash('sha256');
for await (const chunk of createReadStream(archive)) digest.update(chunk);
if (digest.digest('hex') !== expected[1]) throw new Error('Backup checksum does not match.');

const scratch = await mkdtemp(path.join(os.tmpdir(), 'minemine-map-export-'));
try {
  await execFile('tar', ['-C', scratch, '-xzf', archive], { timeout: 120_000, maxBuffer: 1024 * 1024 });
  const world = path.join(scratch, 'world');
  const worldRoot = await realpath(world);
  if (!(await lstat(world)).isDirectory() || worldRoot !== path.join(await realpath(scratch), 'world') ||
      !(await lstat(path.join(world, 'world.mt'))).isFile()) throw new Error('Backup has no regular MineMine world.');
  for (const file of ['map.sqlite', 'town-map-claims.json']) {
    const target = path.join(world, file);
    if (!(await lstat(target)).isFile() || await realpath(target) !== target) throw new Error(`Backup has no regular ${file}.`);
  }
  const database = path.join(world, 'map.sqlite');
  const integrity = await execFile('sqlite3', ['-readonly', database, 'PRAGMA integrity_check;'], { timeout: 30_000 });
  if (integrity.stdout.trim() !== 'ok') throw new Error('Backup map database failed integrity check.');
  const claimsRaw = await readFile(path.join(world, 'town-map-claims.json'), 'utf8');
  if (claimsRaw.length > 1024 * 1024) throw new Error('Town map export is too large.');
  const sourceClaims = JSON.parse(claimsRaw);
  if (sourceClaims.version !== 1 || Object.keys(sourceClaims).sort().join(',') !== 'claims,version') throw new Error('Unexpected town map export.');
  const claims = validateClaims(sourceClaims.claims).filter(claim =>
    claim.x1 < 512 && claim.x2 >= -512 && claim.z1 < 512 && claim.z2 >= -512);
  const rendered = path.join(scratch, 'rendered.png');
  await execFile(mapper, [
    '--backend', 'sqlite3', '--colors', colors, '--geometry=-512:-512+1024+1024',
    '--min-y=-64', '--max-y=512', '--bgcolor', '#101b18', '--origincolor', '#d4f18a',
    '--draworigin', '--noemptyimage', '-i', world, '-o', rendered,
  ], { timeout: 180_000, maxBuffer: 5 * 1024 * 1024 });
  const image = await readFile(rendered);
  const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
  if (image.length < 1024 || image.length > 10 * 1024 * 1024 ||
      image.subarray(0, 8).toString('base64') !== 'iVBORw0KGgo=' || width !== 1024 || height !== 1024) {
    throw new Error('Rendered map has unexpected PNG size or dimensions.');
  }
  const extentResult = await execFile('sqlite3', ['-readonly', '-separator', ',', database,
    'select min(x)*16, max(x)*16+15, min(z)*16, max(z)*16+15 from blocks where y between -4 and 32'], { timeout: 30_000 });
  const extentFields = extentResult.stdout.trim().split(',');
  const extent = extentFields.map(Number);
  if (extent.length !== 4 || extentFields.some(value => value === '') ||
      extent.some(value => !Number.isFinite(value))) throw new Error('No mapped blocks in the expected vertical range.');
  const [minX, maxX, minZ, maxZ] = extent;
  const focus = {
    x: Math.max(-512, Math.min(511, Math.round((minX + maxX) / 2))),
    z: Math.max(-512, Math.min(511, Math.round((minZ + maxZ) / 2))),
    span: Math.min(1024, Math.max(128, maxX - minX + 81, maxZ - minZ + 81)),
  };
  const hash = createHash('sha256').update(image).digest('hex');
  const imageName = `snapshot-${hash.slice(0, 16)}.png`;
  const finalImage = path.join(mapDir, imageName);
  try {
    if ((await stat(finalImage)).size !== image.length ||
        createHash('sha256').update(await readFile(finalImage)).digest('hex') !== hash) {
      throw new Error('Existing map image name has different contents.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temporaryImage = path.join(mapDir, `${imageName}.${process.pid}.tmp`);
    try {
      await copyFile(rendered, temporaryImage);
      await chmod(temporaryImage, 0o644);
      await rename(temporaryImage, finalImage);
    } finally { await rm(temporaryImage, { force: true }); }
  }
  const metadata = {
    kind: 'snapshot', world: 'MineMine shared world', generatedAt: capturedAt,
    sourceBackup: path.basename(archive),
    geometry: { minX: -512, minZ: -512, width, height }, focus,
    townClaims: claims, mapperCommit: '88c7381a20ada1992169522d590ebad36195507e',
    sha256: hash, bytes: image.length, image: imageName,
  };
  const temporary = path.join(mapDir, `snapshot.json.${process.pid}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(metadata, null, 2) + '\n', { mode: 0o644, flag: 'wx' });
    await chmod(temporary, 0o644);
    await rename(temporary, path.join(mapDir, 'snapshot.json'));
  } finally { await rm(temporary, { force: true }); }
  console.log(`Published ${imageName} from verified backup captured ${capturedAt}; ${claims.length} public town claims.`);
} finally { await rm(scratch, { recursive: true, force: true }); }
