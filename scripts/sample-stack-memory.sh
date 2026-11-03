#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo 'usage: sample-stack-memory.sh NATIVE_PID API_PID OUTPUT_CSV STOP_FILE' >&2
  exit 2
fi

native_pid=$1
api_pid=$2
output=$3
stop_file=$4
printf 'epoch,native_rss_kib,api_rss_kib,total_rss_kib\n' > "$output"

while [ ! -e "$stop_file" ]; do
  if [ -r "/proc/$native_pid/status" ] && [ -r "/proc/$api_pid/status" ]; then
    native_rss=$(awk '/^VmRSS:/ { print $2; exit }' "/proc/$native_pid/status")
    api_rss=$(awk '/^VmRSS:/ { print $2; exit }' "/proc/$api_pid/status")
    if [[ $native_rss =~ ^[0-9]+$ && $api_rss =~ ^[0-9]+$ ]]; then
      printf '%s,%s,%s,%s\n' "$(date +%s)" "$native_rss" "$api_rss" "$((native_rss + api_rss))" >> "$output"
    fi
  fi
  sleep 1
done

if [ "$(wc -l < "$output")" -lt 2 ]; then
  echo 'No native/API memory samples were recorded.' >&2
  exit 1
fi
