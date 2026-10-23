#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo 'usage: ci-api-service.sh WORLD_DIR CONSOLE_LOG NODE_BINARY ECONOMY_ENV_FILE' >&2
  exit 2
fi

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_dir"
set -a
# This disposable CI file contains local contract addresses, never keys.
source "$4"
set +a
export GAME_ENABLED=true ENGINE_ADAPTER_READY=true DEBUG_GAME_PROXY=true WORLD_DIR="$1"
exec "$3" server/index.mjs > "$2" 2>&1
