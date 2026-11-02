#!/usr/bin/env bash
set -euo pipefail

# Render only a copied, stopped CI world. Never publish this source directory:
# the world contains private player and wallet authentication data.
mapper_commit=88c7381a20ada1992169522d590ebad36195507e
source_dir=runtime/minetestmapper-src
build_dir=runtime/minetestmapper-build
world_dir=runtime/static-map-world
image_file=runtime/static-world-map.png

mkdir -p "$source_dir"
git -C "$source_dir" init -q
git -C "$source_dir" remote add origin https://github.com/luanti-org/minetestmapper.git
GIT_TERMINAL_PROMPT=0 git -C "$source_dir" fetch --depth=1 origin "$mapper_commit"
test "$(git -C "$source_dir" rev-parse FETCH_HEAD^{commit})" = "$mapper_commit"
git -C "$source_dir" checkout --quiet --detach "$mapper_commit"
cmake -S "$source_dir" -B "$build_dir" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DENABLE_LEVELDB=OFF -DENABLE_REDIS=OFF -DENABLE_POSTGRESQL=OFF
cmake --build "$build_dir" -j 2

cp -a runtime/native-world "$world_dir"
test "$(sqlite3 "$world_dir/map.sqlite" 'PRAGMA integrity_check;')" = ok
"$build_dir/minetestmapper" \
  --backend sqlite3 \
  --colors "$source_dir/colors.txt" \
  --geometry=-512:-512+1024+1024 \
  --min-y=-64 --max-y=512 \
  --draworigin --noemptyimage \
  -i "$world_dir" -o "$image_file" > runtime/static-map-render.log 2>&1

node --input-type=module <<'EOF'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const image = readFileSync('runtime/static-world-map.png');
if (image.subarray(0, 8).toString('base64') !== 'iVBORw0KGgo=') throw new Error('Static map is not a PNG.');
const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
if (width !== 1024 || height !== 1024 || image.length < 1024) throw new Error('Static map has unexpected dimensions or is empty.');
const metadata = {
  kind: 'snapshot',
  world: 'MineMine native CI test world',
  generatedAt: new Date().toISOString(),
  geometry: { minX: -512, minZ: -512, width, height },
  mapperCommit: '88c7381a20ada1992169522d590ebad36195507e',
  sha256: createHash('sha256').update(image).digest('hex'),
  bytes: image.length,
};
writeFileSync('runtime/static-world-map.json', JSON.stringify(metadata, null, 2) + '\n');
console.log(`Static snapshot: ${width}×${height}, ${image.length} bytes, ${metadata.sha256}`);
EOF
printf 'Mapped source blocks: %s\n' "$(sqlite3 "$world_dir/map.sqlite" 'select count(*) from blocks')"
