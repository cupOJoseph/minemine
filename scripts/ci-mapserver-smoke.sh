#!/usr/bin/env bash
set -euo pipefail

# This spike never points mapserver at the live CI world. The binary and its
# checksum are pinned to the upstream v4.11.0 release.
release=4.11.0
archive="mapserver_${release}_linux_amd64.tar.gz"
expected=21ab70f77ce830e16e254c0a20cba46422ca254c46cdbe554a16141d93d9f869
mkdir -p runtime/mapserver-download
if [ -n "${MAPSERVER_BINARY:-}" ]; then
  test -x "$MAPSERVER_BINARY"
  cp "$MAPSERVER_BINARY" runtime/mapserver-download/mapserver
else
  curl --fail --location --silent --show-error --retry 3 \
    "https://github.com/minetest-mapserver/mapserver/releases/download/v${release}/${archive}" \
    -o "runtime/mapserver-download/${archive}"
  printf '%s  %s\n' "$expected" "runtime/mapserver-download/${archive}" | sha256sum --check
  tar -C runtime/mapserver-download -xzf "runtime/mapserver-download/${archive}"
fi

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
if (process.env.MAPSERVER_BURST_PROOF === 'true') config.incrementalrenderingtimer = '1s';
config.mapblockaccessor = { ...config.mapblockaccessor, maxitems: 500 };
config.enableprometheus = false;
writeFileSync(file, JSON.stringify(config, null, 2));
EOF

(
  cd runtime/mapserver-world
  exec ../mapserver-download/mapserver > ../mapserver-console.log 2>&1
) &
mapper_pid=$!
native_pid=''
api_pid=''
cleanup() {
  if [ -n "$native_pid" ]; then
    kill -INT "$native_pid" 2>/dev/null || true
    wait "$native_pid" 2>/dev/null || true
  fi
  if [ -n "$api_pid" ]; then
    kill -INT "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  kill "$mapper_pid" 2>/dev/null || true
  wait "$mapper_pid" 2>/dev/null || true
}
trap cleanup EXIT
if [ "${MAPSERVER_CAPACITY_PROOF:-false}" = true ]; then
  PUBLIC_ORIGIN=http://127.0.0.1:18082 HOST=127.0.0.1 PORT=18082 \
    WORLD_DIR="$GITHUB_WORKSPACE/runtime/mapserver-world" \
    GAME_ENABLED=true ENGINE_ADAPTER_READY=true \
    "${NODE_BINARY:-node}" server/index.mjs > runtime/mapserver-api-console.log 2>&1 &
  api_pid=$!
  api_ready=0
  for attempt in {1..30}; do
    if curl --fail --silent http://127.0.0.1:18082/api/health -o runtime/mapserver-api-health.json; then
      api_ready=1
      break
    fi
    if ! kill -0 "$api_pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if [ "$api_ready" -ne 1 ]; then
    cat runtime/mapserver-api-console.log
    echo 'MineMine API did not start during the map capacity rehearsal.'
    exit 1
  fi
fi
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
    if [ "${MAPSERVER_LIVE_EDIT_PROOF:-false}" = true ] && [[ "$candidate" != runtime/mapserver-world/mapserver.tiles/0/12/* ]]; then continue; fi
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
if [ "${MAPSERVER_BURST_PROOF:-false}" = true ]; then
  completed=0
  for attempt in {1..60}; do
    if grep -Fq 'initial rendering complete' runtime/mapserver-console.log; then
      completed=1
      break
    fi
    if ! kill -0 "$mapper_pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if [ "$completed" -ne 1 ]; then
    tail -60 runtime/mapserver-console.log
    echo 'Patched mapserver did not complete initial rendering.'
    exit 1
  fi
  sleep 2
  # One SQLite statement gives 343 existing blocks the same second-resolution
  # mtime through mapserver's trigger. Their map data stays unchanged.
  sqlite3 runtime/mapserver-world/map.sqlite \
    'update blocks set data=data where rowid in (select rowid from blocks order by rowid limit 343)'
  burst_mtime=$(sqlite3 runtime/mapserver-world/map.sqlite 'select max(mtime) from blocks')
  burst_count=$(sqlite3 runtime/mapserver-world/map.sqlite "select count(*) from blocks where mtime=$burst_mtime")
  test "$burst_count" = 343
  drained=0
  for attempt in {1..45}; do
    read -r batches fetched < <(awk -v stamp="$burst_mtime" '
      /msg="incremental rendering"/ && index($0, "lastMtime=" stamp) {
        batches++;
        for (i = 1; i <= NF; i++) if ($i ~ /^fetched=/) {
          split($i, pair, "="); fetched += pair[2];
        }
      }
      END { print batches+0, fetched+0 }
    ' runtime/mapserver-console.log)
    if [ "$batches" -eq 3 ] && [ "$fetched" -eq 343 ]; then
      drained=1
      break
    fi
    if ! kill -0 "$mapper_pid" 2>/dev/null; then break; fi
    sleep 2
  done
  if [ "$drained" -ne 1 ]; then
    tail -60 runtime/mapserver-console.log
    echo "Patched mapserver fetched $fetched of 343 same-second blocks in $batches batches."
    exit 1
  fi
  printf 'Patched incremental renderer drained %s same-second blocks in %s bounded batches.\n' "$fetched" "$batches"
fi
if [ "${MAPSERVER_LIVE_EDIT_PROOF:-false}" = true ]; then
  curl --fail --silent --show-error "$(tile_url "$tile")" -o runtime/mapserver-tile-before-edit.png
  IFS=/ read -r tile_layer tile_zoom tile_x tile_y_file <<< "$tile_route"
  tile_y=${tile_y_file%.png}
  if [[ "$tile_zoom" != 12 || ! "$tile_x" =~ ^-?[0-9]+$ || ! "$tile_y" =~ ^-?[0-9]+$ ]]; then
    echo 'Mapserver returned unexpected zoom-12 tile coordinates.'
    exit 1
  fi
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
  printf '{"x":%d,"y":%d,"z":%d}\n' "$edit_x" "$edit_y" "$edit_z" > runtime/mapserver-world/map-edit-target.json
  mtime_before=$(sqlite3 runtime/mapserver-world/map.sqlite "select mtime from blocks where x=$block_x and y=$block_y and z=$block_z limit 1")
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
  tile_refreshed=0
  for attempt in {1..55}; do
    if ! kill -0 "$native_pid" 2>/dev/null || ! kill -0 "$mapper_pid" 2>/dev/null; then break; fi
    mtime_after=$(sqlite3 runtime/mapserver-world/map.sqlite "select mtime from blocks where x=$block_x and y=$block_y and z=$block_z limit 1")
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
    printf 'Target block mtime before=%s after=%s; native edit marker exists=%s.\n' "$mtime_before" "${mtime_after:-unknown}" "$edit_ready"
    echo 'Patched mapserver did not refresh the edited tile while Luanti was running.'
    exit 1
  fi
  printf 'Live map tile %s refreshed after native gold edit at (%s,%s,%s), poll %s.\n' "$tile_route" "$edit_x" "$edit_y" "$edit_z" "$attempt"
  kill -INT "$native_pid" 2>/dev/null || true
  wait "$native_pid" 2>/dev/null || true
  native_pid=''
  rm -r runtime/mapserver-world/worldmods/map_edit_probe
  sed -i '/^load_mod_map_edit_probe = true$/d' runtime/mapserver-world/world.mt
fi
if [ "${MAPSERVER_SEQUENCE_RESTART_PROOF:-false}" = true ]; then
  if [ "${MAPSERVER_LIVE_EDIT_PROOF:-false}" != true ]; then
    echo 'Sequence restart proof requires the live edit target.'
    exit 1
  fi
  settings_db=runtime/mapserver-world/mapserver.sqlite
  world_db=runtime/mapserver-world/map.sqlite
  test -s "$settings_db"
  cursor_before=$(sqlite3 "$settings_db" "select json_extract(value, '$.seq') from settings where key='incremental_cursor_v2'")
  test "${cursor_before:-0}" -gt 0
  counter_before=$(sqlite3 "$world_db" 'select seq from mapserver_change_counter where id=1')
  test "$counter_before" -ge "$cursor_before"
  settings_backup=runtime/mapserver-settings-pre-crash.sqlite
  sqlite3 "$settings_db" ".backup '$settings_backup'"
  rollback_cursor=$(sqlite3 "$settings_backup" "select json_extract(value, '$.seq') from settings where key='incremental_cursor_v2'")
  test "${rollback_cursor:-0}" -ge "$cursor_before"
  # Simulate an abrupt process death, then make a world edit while the mapper
  # is down. Its dirty row must survive and be consumed after restart.
  kill -KILL "$mapper_pid" 2>/dev/null || true
  wait "$mapper_pid" 2>/dev/null || true
  sqlite3 "$world_db" "update blocks set data=data where x=$block_x and y=$block_y and z=$block_z"
  counter_after=$(sqlite3 "$world_db" 'select seq from mapserver_change_counter where id=1')
  test "$counter_after" -gt "$counter_before"
  test "$rollback_cursor" -lt "$counter_after"
  start_restarted_mapper() {
    local log=$1
    (
      cd runtime/mapserver-world
      exec ../mapserver-download/mapserver > "../$log" 2>&1
    ) &
    mapper_pid=$!
    restart_ready=0
    for attempt in {1..30}; do
      if kill -0 "$mapper_pid" 2>/dev/null &&
         curl --fail --silent --show-error http://127.0.0.1:18080/ -o /dev/null 2>/dev/null; then
        restart_ready=1
        break
      fi
      if ! kill -0 "$mapper_pid" 2>/dev/null; then break; fi
      sleep 1
    done
    if [ "$restart_ready" -ne 1 ]; then
      tail -60 "runtime/$log"
      echo 'Patched mapserver did not restart on the copied world.'
      exit 1
    fi
  }
  wait_for_sequence() {
    local log=$1
    local current=0
    for attempt in {1..30}; do
      if ! kill -0 "$mapper_pid" 2>/dev/null; then break; fi
      current=$(sqlite3 "$settings_db" "select json_extract(value, '$.seq') from settings where key='incremental_cursor_v2'")
      if [ "${current:-0}" -ge "$counter_after" ]; then
        cursor_after=$current
        return 0
      fi
      sleep 1
    done
    tail -60 "runtime/$log"
    echo 'Patched mapserver did not replay the durable dirty sequence.'
    return 1
  }
  start_restarted_mapper mapserver-restart-console.log
  wait_for_sequence mapserver-restart-console.log
  first_restart_cursor=$cursor_after
  # Restore an older settings cursor without touching the world database. The
  # retained dirty queue must allow this previously processed edit to replay.
  kill -KILL "$mapper_pid" 2>/dev/null || true
  wait "$mapper_pid" 2>/dev/null || true
  rm -f "$settings_db" "$settings_db-wal" "$settings_db-shm"
  cp "$settings_backup" "$settings_db"
  restored_cursor=$(sqlite3 "$settings_db" "select json_extract(value, '$.seq') from settings where key='incremental_cursor_v2'")
  test "$restored_cursor" = "$rollback_cursor"
  start_restarted_mapper mapserver-replay-console.log
  wait_for_sequence mapserver-replay-console.log
  dirty_count=$(sqlite3 "$world_db" 'select count(*) from mapserver_dirty')
  world_count=$(sqlite3 "$world_db" 'select count(*) from blocks')
  test "$dirty_count" -le "$world_count"
  printf 'Mapserver survived SIGKILL and cursor rollback %s: first restart %s, replay %s; dirty rows %s / world blocks %s; world SQLite bytes %s.\n' \
    "$rollback_cursor" "$first_restart_cursor" "$cursor_after" "$dirty_count" "$world_count" "$(stat -c %s "$world_db")"
fi
if [ -n "$api_pid" ]; then
  curl --fail --silent --show-error http://127.0.0.1:18082/api/health -o runtime/mapserver-api-health.json
  kill -INT "$api_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
  api_pid=''
fi
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
