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
npm run account:build
test -s public/account/account.js
test -s public/account/account.js.LEGAL.txt
test -x vendor/native/bin/luantiserver
test -f vendor/native/games/minetest/game.conf
test -f public/engine/build.json
test -f public/engine/adapter.js
test -f public/engine/connect.html
test -f package-lock.json
test -x runtime/minetestmapper-build/minetestmapper
test -f runtime/minetestmapper-src/colors.txt
test -f runtime/minetestmapper-src/COPYING
test -f runtime/minetestmapper-src/AUTHORS

mkdir -p "$stage/vendor/native/bin" "$stage/vendor/native/games" "$stage/vendor/mapper" "$stage/deploy" "$stage/scripts" "$stage/test/integration"
cp -a vendor/native/bin/luantiserver "$stage/vendor/native/bin/"
cp -a vendor/native/builtin vendor/native/textures "$stage/vendor/native/"
cp -a vendor/native/games/minetest "$stage/vendor/native/games/"
rm -rf "$stage/vendor/native/games/minetest/.git"
cp -a vendor/native/LICENSE.txt vendor/native/COPYING.LESSER "$stage/vendor/native/"
cp -a runtime/minetestmapper-build/minetestmapper "$stage/vendor/mapper/"
cp -a runtime/minetestmapper-src/colors.txt runtime/minetestmapper-src/COPYING runtime/minetestmapper-src/AUTHORS "$stage/vendor/mapper/"
cp -a public server game "$stage/"
test -f "$stage/public/engine/notices/THIRD_PARTY.md"
cp THIRD_PARTY.md "$stage/THIRD_PARTY.md"
cp THIRD_PARTY.md "$stage/public/engine/notices/THIRD_PARTY.md"
cp -a deploy/vps "$stage/deploy/"
cp -a scripts/setup-world.mjs "$stage/scripts/"
cp -a scripts/publish-map-from-backup.mjs "$stage/scripts/"
cp -a scripts/refresh-map-from-backup.mjs "$stage/scripts/"
cp -a scripts/sync-spacetime-profiles.mjs "$stage/scripts/"
cp -a test/integration/ens-live.mjs "$stage/test/integration/"
cp package.json package-lock.json upstream.sources.json .env.example "$stage/"
git rev-parse HEAD > "$stage/BUILD_COMMIT"
ldd vendor/native/bin/luantiserver > "$stage/native-library-dependencies.txt"
if grep -q 'not found' "$stage/native-library-dependencies.txt"; then
  echo 'The native server has unresolved shared libraries.' >&2
  exit 1
fi
ldd runtime/minetestmapper-build/minetestmapper > "$stage/mapper-library-dependencies.txt"
if grep -q 'not found' "$stage/mapper-library-dependencies.txt"; then
  echo 'The world mapper has unresolved shared libraries.' >&2
  exit 1
fi

tar -C "$stage" -czf "$output" .
(cd "$(dirname "$output")" && sha256sum "$(basename "$output")" > "$(basename "$output").sha256")
echo "Packaged $(du -h "$output" | cut -f1) runtime archive at $output"
