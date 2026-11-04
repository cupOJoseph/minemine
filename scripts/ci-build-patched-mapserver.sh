#!/usr/bin/env bash
set -euo pipefail

# Experiment on the pinned upstream source. Do not replace the public map
# service until copied-world edits and whole-VM capacity pass.
root=$PWD
source_dir="$root/runtime/mapserver-patched-source"
binary="$root/runtime/mapserver-patched"
cursor_patch="$root/patches/mapserver/001-bounded-cursor.patch"
sequence_patch="$root/patches/mapserver/002-transactional-dirty-sequence.patch"
expected=e558dc784522b4a19357136a906640cee14e16d5

mkdir -p "$root/runtime"
test ! -e "$source_dir"
git clone --depth 1 --branch v4.11.0 https://github.com/minetest-mapserver/mapserver.git "$source_dir"
test "$(git -C "$source_dir" rev-parse HEAD)" = "$expected"
git -C "$source_dir" apply --check "$cursor_patch"
git -C "$source_dir" apply "$cursor_patch"
git -C "$source_dir" apply --check "$sequence_patch"
git -C "$source_dir" apply "$sequence_patch"
(
  cd "$source_dir"
  go test ./...
  go build -o "$binary" .
)
test -s "$binary"
printf 'Patched mapserver source: %s; binary SHA-256: ' "$expected"
sha256sum "$binary"
