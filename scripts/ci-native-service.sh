#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo 'usage: ci-native-service.sh WORLD_DIR ENGINE_LOG CONSOLE_LOG [CONFIG]' >&2
  exit 2
fi

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_dir/vendor/native"
exec bin/luantiserver --info --world "$1" --config "${4:-$repo_dir/game/minetest.conf}" --logfile "$2" > "$3" 2>&1
