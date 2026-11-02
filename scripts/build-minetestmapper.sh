#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mapper_commit=88c7381a20ada1992169522d590ebad36195507e
source_dir="$repo_dir/runtime/minetestmapper-src"
build_dir="$repo_dir/runtime/minetestmapper-build"

if [ ! -d "$source_dir/.git" ]; then
  mkdir -p "$source_dir"
  git -C "$source_dir" init -q
  git -C "$source_dir" remote add origin https://github.com/luanti-org/minetestmapper.git
  GIT_TERMINAL_PROMPT=0 git -C "$source_dir" fetch --depth=1 origin "$mapper_commit"
  test "$(git -C "$source_dir" rev-parse FETCH_HEAD^{commit})" = "$mapper_commit"
  git -C "$source_dir" checkout --quiet --detach "$mapper_commit"
fi
test "$(git -C "$source_dir" rev-parse HEAD)" = "$mapper_commit"
test -f "$source_dir/colors.txt"
test -f "$source_dir/COPYING"
if [ ! -x "$build_dir/minetestmapper" ]; then
  cmake -S "$source_dir" -B "$build_dir" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DENABLE_LEVELDB=OFF -DENABLE_REDIS=OFF -DENABLE_POSTGRESQL=OFF
  cmake --build "$build_dir" -j 2
fi
test -x "$build_dir/minetestmapper"
