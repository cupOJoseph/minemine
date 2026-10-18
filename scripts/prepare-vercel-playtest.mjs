import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateWasm } from './stage-playtest.mjs';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export function prepareVercelPlaytest(root = project) {
  const engine = path.join(root, 'public/engine');
  const build = JSON.parse(fs.readFileSync(path.join(engine, 'build.json'), 'utf8'));
  if (build.kind !== 'solo-engine-playtest' || !/^[a-f0-9]{12}$/.test(build.release)) throw new Error('Unrecognized engine build.');
  validateWasm(path.join(engine, build.release, 'luanti.wasm'));
  for (const [relative, expected] of Object.entries(build.assets)) {
    if (relative.split('/').some(part => !part || part.startsWith('.') || part.includes('\\'))) throw new Error('Invalid asset path.');
    const asset = fs.readFileSync(path.join(engine, relative));
    if (asset.length !== expected.bytes || createHash('sha256').update(asset).digest('hex') !== expected.sha256) throw new Error('Engine asset differs from its manifest: ' + relative);
  }
  const destination = path.join(root, 'runtime', 'vercel-playtest-' + build.release);
  if (fs.existsSync(destination)) throw new Error('Prepared deployment already exists; review it before replacing.');
  fs.mkdirSync(destination, { recursive: true });
  // Upload only the public engine bundle. Auth services, credentials, world
  // grants, downloaded repositories, and the parent workspace are excluded.
  const output = path.join(destination, 'site');
  fs.cpSync(engine, output, { recursive: true, filter: file => !path.relative(engine, file).split(path.sep).some(part => part.startsWith('.')) });
  const headers = [
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
  ];
  fs.writeFileSync(path.join(destination, 'vercel.json'), JSON.stringify({
    framework: null, buildCommand: '', installCommand: '', outputDirectory: 'site',
    headers: [
      { source: '/(.*)', headers },
      { source: '/' + build.release + '/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/(.*).wasm', headers: [{ key: 'Content-Type', value: 'application/wasm' }] },
      { source: '/', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/build.json', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ],
  }, null, 2) + '\n');
  return destination;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(prepareVercelPlaytest());
