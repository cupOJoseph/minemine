#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/fetch-upstream.mjs
if [ "$(uname -s)" != "Linux" ]; then
  echo 'This pinned upstream build requires Linux. Use the manual GitHub Actions WASM workflow.' >&2
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("This pinned Emscripten installer requires Node 24.")'
for tool in cmake tclsh wget zstd gettext git make python3; do
  command -v "$tool" >/dev/null || { echo "Required build tool missing: $tool" >&2; exit 1; }
done
if [ -e public/engine ]; then
  echo 'public/engine already exists. Archive/review it before another build.' >&2
  exit 1
fi
# Build from a separate copy. Keep downloaded source pins and working trees intact.
miners_build_source="$(node scripts/prepare-wasm.mjs)"
(
  cd "$miners_build_source"
  # Explicit bash options are needed: invoking bash directly ignores the
  # upstream shebang's -e and otherwise continues after dependency failures.
  bash -eux build_all.sh
)
node scripts/stage-playtest.mjs "$miners_build_source"
