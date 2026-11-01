#!/usr/bin/env bash
set -euo pipefail

# This spike never points mapserver at the live CI world. The binary and its
# checksum are pinned to the upstream v4.11.0 release.
release=4.11.0
archive="mapserver_${release}_linux_amd64.tar.gz"
expected=21ab70f77ce830e16e254c0a20cba46422ca254c46cdbe554a16141d93d9f869
mkdir -p runtime/mapserver-download
curl --fail --location --silent --show-error --retry 3 \
  "https://github.com/minetest-mapserver/mapserver/releases/download/v${release}/${archive}" \
  -o "runtime/mapserver-download/${archive}"
printf '%s  %s\n' "$expected" "runtime/mapserver-download/${archive}" | sha256sum --check
tar -C runtime/mapserver-download -xzf "runtime/mapserver-download/${archive}"

cp -a runtime/native-world runtime/mapserver-world
test "$(sqlite3 runtime/mapserver-world/map.sqlite 'select count(*) from blocks')" -gt 0
(
  cd runtime/mapserver-world
  ../mapserver-download/mapserver -createconfig
)
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const file = 'runtime/mapserver-world/mapserver.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
config.port = 18080;
config.localhostonly = true;
config.renderingjobs = 1;
config.renderingfetchlimit = 128;
config.renderingqueue = 32;
config.mapblockaccessor = { ...config.mapblockaccessor, maxitems: 500 };
config.enableprometheus = false;
writeFileSync(file, JSON.stringify(config, null, 2));
EOF

(
  cd runtime/mapserver-world
  ../mapserver-download/mapserver > ../mapserver-console.log 2>&1
) &
mapper_pid=$!
trap 'kill "$mapper_pid" 2>/dev/null || true; wait "$mapper_pid" 2>/dev/null || true' EXIT
ready=0
for attempt in {1..45}; do
  if curl --fail --silent --show-error http://127.0.0.1:18080/ -o runtime/mapserver-index.html 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$mapper_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  cat runtime/mapserver-console.log
  echo 'Mapserver did not serve the copied Luanti world.'
  exit 1
fi
test -s runtime/mapserver-index.html
tile=''
for attempt in {1..45}; do
  tile=$(find runtime/mapserver-world/mapserver.tiles -type f -name '*.png' -print -quit 2>/dev/null || true)
  if [ -n "$tile" ]; then break; fi
  if ! kill -0 "$mapper_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [ -z "$tile" ]; then
  cat runtime/mapserver-console.log
  echo 'Mapserver served HTML but did not render any terrain tiles.'
  exit 1
fi
tile_route=${tile#runtime/mapserver-world/mapserver.tiles/}
curl --fail --silent --show-error "http://127.0.0.1:18080/api/tile/${tile_route%.png}" -o runtime/mapserver-tile.png
test "$(head -c 8 runtime/mapserver-tile.png | base64)" = 'iVBORw0KGgo='
printf 'Mapserver served copied Luanti world; HTML bytes: %s\n' "$(wc -c < runtime/mapserver-index.html)"
printf 'Rendered tile: %s; tile store: %s bytes\n' "$tile_route" "$(du -sb runtime/mapserver-world/mapserver.tiles | cut -f1)"
printf 'Map blocks on copy: %s\n' "$(sqlite3 runtime/mapserver-world/map.sqlite 'select count(*) from blocks')"
printf 'SQLite triggers after mapserver startup: %s\n' "$(sqlite3 runtime/mapserver-world/map.sqlite "select count(*) from sqlite_master where type='trigger'")"
kill "$mapper_pid" 2>/dev/null || true
wait "$mapper_pid" 2>/dev/null || true
trap - EXIT
set +e
(cd vendor/native && timeout --signal=INT 8s bin/luantiserver --info --world "$GITHUB_WORKSPACE/runtime/mapserver-world" --config "$GITHUB_WORKSPACE/game/minetest.conf" --logfile "$GITHUB_WORKSPACE/runtime/mapserver-world-restart.log") > runtime/mapserver-world-restart-console.log 2>&1
result=$?
set -e
if [ "$result" -ne 124 ]; then
  cat runtime/mapserver-world-restart-console.log
  echo "Native server could not restart the mapserver-touched world (status $result)."
  exit 1
fi
grep -Fq 'listening on 127.0.0.1:30000' runtime/mapserver-world-restart-console.log
if grep -Fq 'ERROR[Main]' runtime/mapserver-world-restart-console.log; then
  cat runtime/mapserver-world-restart-console.log
  exit 1
fi
