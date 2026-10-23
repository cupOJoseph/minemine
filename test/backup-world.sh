#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/minemine-backup-check.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bin" "$scratch/world/town_quotas" "$scratch/backups"
printf 'gameid = minetest\nbackend = sqlite3\n' > "$scratch/world/world.mt"
printf '{"blocks":9}\n' > "$scratch/world/town_quotas/w_0123456789abcdef0.json"
python3 - "$scratch/world/map.sqlite" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as database:
    database.execute('CREATE TABLE nodes (name TEXT NOT NULL)')
    database.execute('INSERT INTO nodes VALUES (?)', ('default:stone',))
PY

printf 'active\n' > "$scratch/native.state"
printf 'active\n' > "$scratch/web.state"
cat > "$scratch/bin/systemctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  show) test "$2" = -P && test "$3" = LoadState && printf 'loaded\n' ;;
  is-active) test "$(cat "$MINEMINE_TEST_STATE/${3}.state")" = active ;;
  stop) printf 'inactive\n' > "$MINEMINE_TEST_STATE/${2}.state" ;;
  start) printf 'active\n' > "$MINEMINE_TEST_STATE/${2}.state" ;;
  *) exit 2 ;;
esac
SH
real_tar=$(command -v tar)
cat > "$scratch/bin/tar" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${MINEMINE_FAIL_TAR:-0}" = 1 ] && [ "${3:-}" = -czf ]; then exit 17; fi
if [ "${3:-}" = -czf ]; then
  test "$(cat "$MINEMINE_TEST_STATE/native.state")" = inactive
  test "$(cat "$MINEMINE_TEST_STATE/web.state")" = inactive
fi
exec "$MINEMINE_REAL_TAR" "$@"
SH
chmod +x "$scratch/bin/systemctl" "$scratch/bin/tar"
export MINEMINE_TEST_STATE="$scratch" MINEMINE_REAL_TAR="$real_tar"
export MINEMINE_NATIVE_UNIT=native MINEMINE_WEB_UNIT=web
export PATH="$scratch/bin:$PATH"

bash "$repo_dir/deploy/vps/backup-world.sh" "$scratch/world" "$scratch/backups"
test "$(cat "$scratch/native.state")" = active
test "$(cat "$scratch/web.state")" = active
archive=$(find "$scratch/backups" -maxdepth 1 -name '*.tar.gz' -print -quit)
test -n "$archive"
(cd "$scratch/backups" && sha256sum -c "$(basename "$archive").sha256")
mkdir "$scratch/restore"
"$real_tar" -C "$scratch/restore" -xzf "$archive"
cmp "$scratch/world/world.mt" "$scratch/restore/world/world.mt"
cmp "$scratch/world/town_quotas/w_0123456789abcdef0.json" "$scratch/restore/world/town_quotas/w_0123456789abcdef0.json"
python3 - "$scratch/restore/world/map.sqlite" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as database:
    assert database.execute('PRAGMA integrity_check').fetchone() == ('ok',)
    assert database.execute('SELECT name FROM nodes').fetchone() == ('default:stone',)
PY

export MINEMINE_FAIL_TAR=1
if bash "$repo_dir/deploy/vps/backup-world.sh" "$scratch/world" "$scratch/backups"; then
  echo 'Expected a failed archive command to fail the backup.' >&2
  exit 1
fi
test "$(cat "$scratch/native.state")" = active
test "$(cat "$scratch/web.state")" = active
test "$(find "$scratch/backups" -maxdepth 1 -name '*.partial' | wc -l | tr -d ' ')" = 0
unset MINEMINE_FAIL_TAR

printf 'inactive\n' > "$scratch/web.state"
bash "$repo_dir/deploy/vps/backup-world.sh" "$scratch/world" "$scratch/backups"
test "$(cat "$scratch/native.state")" = active
test "$(cat "$scratch/web.state")" = inactive
echo 'PASS cold world backup, checksum, restored SQLite/town data, failure restart and inactive-service preservation.'
