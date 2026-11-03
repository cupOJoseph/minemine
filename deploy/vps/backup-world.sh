#!/usr/bin/env bash
set -euo pipefail
umask 077

if [ "$#" -gt 2 ]; then
  echo 'usage: backup-world.sh [WORLD_DIR] [BACKUP_DIR]' >&2
  exit 2
fi

world_dir=${1:-/srv/minemine/world}
backup_dir=${2:-/srv/minemine/backups}
native_unit=${MINEMINE_NATIVE_UNIT:-minemine-native.service}
web_unit=${MINEMINE_WEB_UNIT:-minemine-web.service}

if ! command -v systemctl > /dev/null ||
   [ "$(systemctl show -P LoadState "$native_unit")" != loaded ] ||
   [ "$(systemctl show -P LoadState "$web_unit")" != loaded ]; then
  echo 'Both MineMine systemd units must be installed before backing up.' >&2
  exit 1
fi
if [ ! -f "$world_dir/world.mt" ] || [ -L "$world_dir" ]; then
  echo "Not a regular MineMine world directory: $world_dir" >&2
  exit 1
fi
world_dir=$(cd "$world_dir" && pwd -P)
mkdir -p "$backup_dir"
backup_dir=$(cd "$backup_dir" && pwd -P)
case "$backup_dir/" in
  "$world_dir/"*) echo 'The backup directory must be outside the world.' >&2; exit 1 ;;
esac

web_was_active=0
native_was_active=0
if systemctl is-active --quiet "$web_unit"; then web_was_active=1; fi
if systemctl is-active --quiet "$native_unit"; then native_was_active=1; fi
partial=''
resume_services() {
  local result=$?
  trap - EXIT
  if [ -n "$partial" ]; then rm -f -- "$partial" "$partial.sha256" "$archive.partial.sha256"; fi
  if [ "$native_was_active" -eq 1 ]; then systemctl start "$native_unit" || result=1; fi
  if [ "$web_was_active" -eq 1 ]; then systemctl start "$web_unit" || result=1; fi
  exit "$result"
}
trap resume_services EXIT

if [ "$web_was_active" -eq 1 ]; then systemctl stop "$web_unit"; fi
if [ "$native_was_active" -eq 1 ]; then systemctl stop "$native_unit"; fi
if systemctl is-active --quiet "$web_unit" || systemctl is-active --quiet "$native_unit"; then
  echo 'A MineMine service is still active; refusing a live world copy.' >&2
  exit 1
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$backup_dir/minemine-world-$stamp-$$.tar.gz"
if [ -e "$archive" ] || [ -e "$archive.sha256" ]; then
  echo "Refusing to replace an existing backup: $archive" >&2
  exit 1
fi
partial="$archive.partial"
tar -C "$(dirname "$world_dir")" -czf "$partial" "$(basename "$world_dir")"
tar -tzf "$partial" > /dev/null
hash=$(sha256sum "$partial")
printf '%s  %s\n' "${hash%% *}" "$(basename "$archive")" > "$partial.sha256"
mv -- "$partial" "$archive"
partial="$archive"
mv -- "$archive.partial.sha256" "$archive.sha256"
partial=''
echo "Created $archive and its SHA-256 sidecar."
