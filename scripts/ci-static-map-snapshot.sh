#!/usr/bin/env bash
set -euo pipefail

# Render only a copied, stopped CI world. Never publish this source directory:
# the world contains private player and wallet authentication data.
source_dir=runtime/minetestmapper-src
build_dir=runtime/minetestmapper-build
world_dir=runtime/static-map-world
image_file=runtime/static-world-map.png

bash scripts/build-minetestmapper.sh

cp -a runtime/native-world "$world_dir"
test "$(sqlite3 "$world_dir/map.sqlite" 'PRAGMA integrity_check;')" = ok
"$build_dir/minetestmapper" \
  --backend sqlite3 \
  --colors "$source_dir/colors.txt" \
  --geometry=-512:-512+1024+1024 \
  --min-y=-64 --max-y=512 \
  --bgcolor '#101b18' --origincolor '#d4f18a' \
  --draworigin --noemptyimage \
  -i "$world_dir" -o "$image_file" > runtime/static-map-render.log 2>&1
sqlite3 -separator ' ' "$world_dir/map.sqlite" \
  'select min(x)*16, max(x)*16+15, min(z)*16, max(z)*16+15 from blocks where y between -4 and 32' \
  > runtime/static-map-extent.txt

node --input-type=module <<'EOF'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateClaims } from './public/map/claims.mjs';
const image = readFileSync('runtime/static-world-map.png');
if (image.subarray(0, 8).toString('base64') !== 'iVBORw0KGgo=') throw new Error('Static map is not a PNG.');
const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
if (width !== 1024 || height !== 1024 || image.length < 1024) throw new Error('Static map has unexpected dimensions or is empty.');
const extent = readFileSync('runtime/static-map-extent.txt', 'utf8').trim().split(' ').map(Number);
if (extent.length !== 4 || extent.some(value => !Number.isFinite(value))) throw new Error('Static map extent is missing.');
const [minX, maxX, minZ, maxZ] = extent;
const focus = {
  x: Math.max(-512, Math.min(511, Math.round((minX + maxX) / 2))),
  z: Math.max(-512, Math.min(511, Math.round((minZ + maxZ) / 2))),
  span: Math.min(1024, Math.max(128, maxX - minX + 81, maxZ - minZ + 81)),
};
const sourceClaims = JSON.parse(readFileSync('runtime/static-map-world/town-map-claims.json', 'utf8'));
if (sourceClaims.version !== 1 || Object.keys(sourceClaims).sort().join(',') !== 'claims,version') throw new Error('Unexpected town map export.');
const allClaims = validateClaims(sourceClaims.claims);
const probe = JSON.parse(readFileSync('runtime/static-map-world/town-probe-state.json', 'utf8'));
const expectedX = Math.floor(probe.pos.x), expectedZ = Math.floor(probe.pos.z);
if (allClaims.length !== 1 || allClaims[0].town !== 'Probe Town' ||
    allClaims[0].x1 !== expectedX - 1 || allClaims[0].x2 !== expectedX + 1 ||
    allClaims[0].z1 !== expectedZ - 1 || allClaims[0].z2 !== expectedZ + 1) throw new Error('Public claim projection differs from the native paid claim.');
const townClaims = allClaims.filter(claim =>
  claim.x1 < -512 + width && claim.x2 >= -512 && claim.z1 < -512 + height && claim.z2 >= -512);
if (townClaims.length !== 1) throw new Error('Native paid claim is outside the mapped snapshot.');
const metadata = {
  kind: 'snapshot',
  world: 'MineMine native CI test world',
  generatedAt: new Date().toISOString(),
  geometry: { minX: -512, minZ: -512, width, height },
  focus,
  townClaims,
  mapperCommit: '88c7381a20ada1992169522d590ebad36195507e',
  sha256: createHash('sha256').update(image).digest('hex'),
  bytes: image.length,
};
writeFileSync('runtime/static-world-map.json', JSON.stringify(metadata, null, 2) + '\n');
console.log(`Static snapshot: ${width}×${height}, ${image.length} bytes, ${metadata.sha256}`);
EOF
printf 'Mapped source blocks: %s\n' "$(sqlite3 "$world_dir/map.sqlite" 'select count(*) from blocks')"
