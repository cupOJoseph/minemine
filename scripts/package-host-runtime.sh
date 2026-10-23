#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo 'usage: package-host-runtime.sh OUTPUT_TAR_GZ' >&2
  exit 2
fi

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$(dirname "$1")"
output=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
if [ -e "$output" ] || [ -e "$output.sha256" ]; then
  echo "Refusing to replace an existing host archive: $output" >&2
  exit 1
fi
stage=$(mktemp -d "${TMPDIR:-/tmp}/minemine-host-bundle.XXXXXX")
trap 'rm -rf "$stage"' EXIT

cd "$repo_dir"
test -x vendor/native/bin/luantiserver
test -f vendor/native/games/minetest/game.conf
test -f public/engine/build.json
test -f public/engine/adapter.js
test -f public/engine/connect.html
test -f package-lock.json

mkdir -p "$stage/vendor/native/bin" "$stage/vendor/native/games" "$stage/deploy" "$stage/scripts"
cp -a vendor/native/bin/luantiserver "$stage/vendor/native/bin/"
cp -a vendor/native/builtin vendor/native/textures "$stage/vendor/native/"
cp -a vendor/native/games/minetest "$stage/vendor/native/games/"
rm -rf "$stage/vendor/native/games/minetest/.git"
cp -a vendor/native/LICENSE.txt vendor/native/COPYING.LESSER "$stage/vendor/native/"
cp -a public server game "$stage/"
cp -a deploy/vps "$stage/deploy/"
cp -a scripts/setup-world.mjs "$stage/scripts/"
cp package.json package-lock.json upstream.sources.json "$stage/"
git rev-parse HEAD > "$stage/BUILD_COMMIT"
ldd vendor/native/bin/luantiserver > "$stage/native-library-dependencies.txt"
if grep -q 'not found' "$stage/native-library-dependencies.txt"; then
  echo 'The native server has unresolved shared libraries.' >&2
  exit 1
fi

tar -C "$stage" -czf "$output" .
(cd "$(dirname "$output")" && sha256sum "$(basename "$output")" > "$(basename "$output").sha256")
echo "Packaged $(du -h "$output" | cut -f1) runtime archive at $output"
