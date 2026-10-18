import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const file = path.join(root, 'upstream.sources.json');
const manifest = JSON.parse(fs.readFileSync(file));
const resolving = process.argv.includes('--resolve');
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
if (!resolving && Object.values(manifest.sources).some(source => !/^[a-f0-9]{40}$/.test(source.commit || ''))) throw new Error('No complete source lock. Run npm run upstream:fetch -- --resolve, review upstream.sources.json, then commit it before building.');
for (const [name, source] of Object.entries(manifest.sources)) {
  const destination = path.join(root, 'vendor', name);
  fs.mkdirSync(destination, { recursive: true });
  if (!fs.existsSync(path.join(destination, '.git'))) {
    git(['init'], destination);
    git(['remote', 'add', 'origin', source.url], destination);
  }
  if (git(['remote', 'get-url', 'origin'], destination) !== source.url) throw new Error(`Unexpected remote for ${name}.`);
  if (git(['status', '--porcelain'], destination)) throw new Error(`Local changes in ${name}; refusing to overwrite.`);
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: destination, encoding: 'utf8' });
  if (head.error) throw head.error;
  if (!resolving && head.status === 0 && head.stdout.trim() === source.commit) {
    console.log(name + ': ' + source.commit + ' (already present)');
    continue;
  }
  git(['fetch', '--depth=1', 'origin', resolving ? source.ref : source.commit], destination);
  const commit = git(['rev-parse', 'FETCH_HEAD^{commit}'], destination);
  if (!resolving && commit !== source.commit) throw new Error(`Commit mismatch for ${name}.`);
  git(['checkout', '--detach', commit], destination);
  source.commit = commit;
  console.log(`${name}: ${commit}`);
}
if (resolving) {
  manifest.status = 'pinned; build and dependency review still required';
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Review and commit the source lock. Build scripts do not follow moving branches.');
}
