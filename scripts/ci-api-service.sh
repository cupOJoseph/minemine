#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo 'usage: ci-api-service.sh WORLD_DIR CONSOLE_LOG NODE_BINARY' >&2
  exit 2
fi

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_dir"
export GAME_ENABLED=true ENGINE_ADAPTER_READY=true DEBUG_GAME_PROXY=true WORLD_DIR="$1"
exec "$3" server/index.mjs > "$2" 2>&1
