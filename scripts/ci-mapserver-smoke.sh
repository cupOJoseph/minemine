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
config.incrementalrenderingtimer = '2s';
config.mapblockaccessor = { ...config.mapblockaccessor, maxitems: 500 };
config.enableprometheus = false;
writeFileSync(file, JSON.stringify(config, null, 2));
EOF

(
  cd runtime/mapserver-world
  ../mapserver-download/mapserver > ../mapserver-console.log 2>&1
) &
mapper_pid=$!
native_pid=''
cleanup() {
  if [ -n "$native_pid" ]; then
    kill -INT "$native_pid" 2>/dev/null || true
    wait "$native_pid" 2>/dev/null || true
  fi
  kill "$mapper_pid" 2>/dev/null || true
  wait "$mapper_pid" 2>/dev/null || true
}
trap cleanup EXIT
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
rendered=0
for attempt in {1..90}; do
  if grep -Fq 'initial rendering complete' runtime/mapserver-console.log; then
    rendered=1
    break
  fi
  if ! kill -0 "$mapper_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$rendered" -ne 1 ]; then
  tail -40 runtime/mapserver-console.log
  echo 'Mapserver did not finish the initial render of the copied world.'
  exit 1
fi
curl --fail --silent --show-error http://127.0.0.1:18080/api/tile/0/999999/999999/0 -o runtime/mapserver-blank.png
tile_url() {
  local relative=${1#runtime/mapserver-world/mapserver.tiles/}
  local layer zoom x y_file
  IFS=/ read -r layer zoom x y_file <<< "$relative"
  printf 'http://127.0.0.1:18080/api/tile/%s/%s/%s/%s' "$layer" "$x" "${y_file%.png}" "$zoom"
}
tile=''
for attempt in {1..45}; do
  while IFS= read -r -d '' candidate; do
    if [[ "$candidate" != runtime/mapserver-world/mapserver.tiles/0/12/* ]]; then continue; fi
    if cmp -s "$candidate" runtime/mapserver-blank.png; then continue; fi
    if ! curl --fail --silent "$(tile_url "$candidate")" -o runtime/mapserver-tile.png; then continue; fi
    if cmp -s runtime/mapserver-tile.png runtime/mapserver-blank.png; then continue; fi
    tile=$candidate
    break
  done < <(find runtime/mapserver-world/mapserver.tiles -type f -name '*.png' -print0 2>/dev/null || true)
  if [ -n "$tile" ]; then break; fi
  if ! kill -0 "$mapper_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [ -z "$tile" ]; then
  cat runtime/mapserver-console.log
  echo 'Mapserver served HTML but did not render a tile different from its blank response.'
  exit 1
fi
tile_route=${tile#runtime/mapserver-world/mapserver.tiles/}
curl --fail --silent --show-error "$(tile_url "$tile")" -o runtime/mapserver-tile.png
test "$(head -c 8 runtime/mapserver-tile.png | base64)" = 'iVBORw0KGgo='
if cmp -s runtime/mapserver-tile.png runtime/mapserver-blank.png; then
  echo 'Mapserver tile changed back to its blank response before validation.'
  exit 1
fi
cp runtime/mapserver-tile.png runtime/mapserver-tile-before-edit.png
IFS=/ read -r tile_layer tile_zoom tile_x tile_y_file <<< "$tile_route"
tile_y=${tile_y_file%.png}
if [[ ! "$tile_x" =~ ^-?[0-9]+$ || ! "$tile_y" =~ ^-?[0-9]+$ ]]; then
  echo 'Mapserver returned unexpected zoom-12 tile coordinates.'
  exit 1
fi
# At zoom 12 a tile spans two 16-node mapblocks. Edit an existing block in
# that tile: emerging a new height can generate hundreds of blocks and obscure
# whether a normal single-block update refreshes correctly.
block_x_min=$((tile_x * 2))
block_z_min=$((-tile_y * 2 - 2))
read -r block_x block_y block_z < <(sqlite3 -separator ' ' runtime/mapserver-world/map.sqlite "select x,y,z from blocks where x between $block_x_min and $((block_x_min + 1)) and z between $block_z_min and $((block_z_min + 1)) and y between -16 and 159 order by y desc limit 1") || true
if [ -z "${block_x:-}" ]; then
  echo 'The selected rendered tile has no existing mapblock to edit.'
  exit 1
fi
edit_x=$((block_x * 16 + 4))
edit_y=$((block_y * 16 + 15))
edit_z=$((block_z * 16 + 4))
blocks_before=$(sqlite3 runtime/mapserver-world/map.sqlite 'select count(*) from blocks')
printf '{"x":%d,"y":%d,"z":%d}\n' "$edit_x" "$edit_y" "$edit_z" > runtime/mapserver-world/map-edit-target.json
# The upstream mtime trigger has one-second precision, and the incremental
# cursor uses a strict greater-than comparison.
sleep 2
cp -a test/integration/map_edit_probe runtime/mapserver-world/worldmods/map_edit_probe
printf '\nload_mod_map_edit_probe = true\n' >> runtime/mapserver-world/world.mt
cp game/minetest.conf runtime/mapserver-edit.conf
printf '\nserver_map_save_interval = 1\n' >> runtime/mapserver-edit.conf
(
  cd vendor/native
  exec timeout --signal=INT 120s bin/luantiserver --info --world "$GITHUB_WORKSPACE/runtime/mapserver-world" --config "$GITHUB_WORKSPACE/runtime/mapserver-edit.conf" --logfile "$GITHUB_WORKSPACE/runtime/mapserver-edit-native.log"
) > runtime/mapserver-edit-native-console.log 2>&1 &
native_pid=$!
edit_ready=0
for attempt in {1..45}; do
  if [ -s runtime/mapserver-world/map-edit-result.txt ]; then
    edit_ready=1
    break
  fi
  if ! kill -0 "$native_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$edit_ready" -ne 1 ]; then
  tail -60 runtime/mapserver-edit-native-console.log
  echo 'Native Luanti did not place the map edit probe.'
  exit 1
fi
blocks_after=$(sqlite3 runtime/mapserver-world/map.sqlite 'select count(*) from blocks')
printf 'Map edit touched existing block (%s,%s,%s); mapblocks before=%s after=%s.\n' "$block_x" "$block_y" "$block_z" "$blocks_before" "$blocks_after"
tile_refreshed=0
for attempt in {1..45}; do
  if ! kill -0 "$native_pid" 2>/dev/null || ! kill -0 "$mapper_pid" 2>/dev/null; then break; fi
  if curl --fail --silent --show-error "$(tile_url "$tile")?after=$attempt" -o runtime/mapserver-tile-after-edit.png &&
     ! cmp -s runtime/mapserver-tile-after-edit.png runtime/mapserver-tile-before-edit.png &&
     ! cmp -s runtime/mapserver-tile-after-edit.png runtime/mapserver-blank.png; then
    tile_refreshed=1
    break
  fi
  sleep 2
done
if [ "$tile_refreshed" -ne 1 ]; then
  tail -60 runtime/mapserver-console.log
  echo 'Mapserver did not refresh the edited tile while native Luanti was running.'
  exit 1
fi
printf 'Live map edit refreshed %s after placing gold at x=%s y=%s z=%s (poll %s).\n' "$tile_route" "$edit_x" "$edit_y" "$edit_z" "$attempt"
printf 'Mapserver served copied Luanti world; HTML bytes: %s\n' "$(wc -c < runtime/mapserver-index.html)"
printf 'Rendered tile: %s; tile store: %s bytes\n' "$tile_route" "$(du -sb runtime/mapserver-world/mapserver.tiles | cut -f1)"
printf 'Map blocks on copy: %s\n' "$(sqlite3 runtime/mapserver-world/map.sqlite 'select count(*) from blocks')"
printf 'SQLite triggers after mapserver startup: %s\n' "$(sqlite3 runtime/mapserver-world/map.sqlite "select count(*) from sqlite_master where type='trigger'")"
kill -INT "$native_pid" 2>/dev/null || true
wait "$native_pid" 2>/dev/null || true
native_pid=''
rm -r runtime/mapserver-world/worldmods/map_edit_probe
sed -i '/^load_mod_map_edit_probe = true$/d' runtime/mapserver-world/world.mt
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
