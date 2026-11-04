#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo 'usage: sample-client-runner.sh OUTPUT_CSV STOP_FILE' >&2
  exit 2
fi

output=$1
stop_file=$2
# RSS is summed across Chromium processes, so shared pages can be counted more
# than once. MemAvailable is the separate host-level pressure indicator.
printf 'epoch,mem_available_kib,chromium_processes,chromium_rss_kib_sum\n' > "$output"

while [ ! -e "$stop_file" ]; do
  available=$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo)
  read -r processes rss < <(ps -eo comm=,rss= | awk '
    tolower($1) ~ /(chrome|chromium|headless)/ && $2 ~ /^[0-9]+$/ {
      count++
      rss += $2
    }
    END { print count+0, rss+0 }
  ')
  if [[ ! $available =~ ^[0-9]+$ ]]; then
    echo 'Runner MemAvailable is unavailable.' >&2
    exit 1
  fi
  printf '%s,%s,%s,%s\n' "$(date +%s)" "$available" "$processes" "$rss" >> "$output"
  sleep 5
done

if [ "$(wc -l < "$output")" -lt 2 ]; then
  echo 'No client-runner samples were recorded.' >&2
  exit 1
fi
