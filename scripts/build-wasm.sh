#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/fetch-upstream.mjs
# Upstream documents Ubuntu as its tested build environment. Use a Linux runner.
# This script downloads its own patched Emscripten toolchain and pinned libraries.
(
  cd vendor/wasm
  bash build_all.sh
)
test -f vendor/wasm/www/index.html
if [ -e public/engine ]; then
  echo 'public/engine already exists. Archive/review it before replacing the engine.' >&2
  exit 1
fi
mkdir -p public/engine
cp -R vendor/wasm/www/. public/engine/
echo 'Engine staged. Adapter and private proxy integration still need verification; GAME_ENABLED remains false.'
