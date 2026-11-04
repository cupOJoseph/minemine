#!/usr/bin/env bash
set -euo pipefail

# Experiment on the pinned upstream source. Do not replace the public map
# service until copied-world edits and whole-VM capacity pass.
root=$PWD
source_dir="$root/runtime/mapserver-patched-source"
binary="$root/runtime/mapserver-patched"
patch="$root/patches/mapserver/001-bounded-cursor.patch"
expected=e558dc784522b4a19357136a906640cee14e16d5

mkdir -p "$root/runtime"
test ! -e "$source_dir"
git clone --depth 1 --branch v4.11.0 https://github.com/minetest-mapserver/mapserver.git "$source_dir"
test "$(git -C "$source_dir" rev-parse HEAD)" = "$expected"
git -C "$source_dir" apply --check "$patch"
git -C "$source_dir" apply "$patch"
(
  cd "$source_dir"
  go test ./...
  go build -o "$binary" .
)
test -s "$binary"
printf 'Patched mapserver source: %s; binary SHA-256: ' "$expected"
sha256sum "$binary"
