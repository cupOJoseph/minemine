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
# /proc/stat is host-wide, including browsers, the service slice, and runner
# tasks. Guest ticks are already counted in user/nice and are not added twice.
printf 'epoch,mem_available_kib,chromium_processes,chromium_rss_kib_sum,host_cpu_busy_pct,host_cpu_steal_pct,host_runnable_tasks,host_online_cpus,cpu_total_ticks,cpu_idle_iowait_ticks,cpu_steal_ticks\n' > "$output"
previous_total=0
previous_busy=0
previous_steal=0
online_cpus=$(getconf _NPROCESSORS_ONLN)

while [ ! -e "$stop_file" ]; do
  available=$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo)
  read -r label cpu_user cpu_nice cpu_system cpu_idle cpu_iowait cpu_irq cpu_softirq cpu_steal _ < /proc/stat
  runnable=$(awk '/^procs_running / { print $2; exit }' /proc/stat)
  read -r processes rss < <(ps -eo comm=,rss= | awk '
    tolower($1) ~ /(chrome|chromium|headless)/ && $2 ~ /^[0-9]+$/ {
      count++
      rss += $2
    }
    END { print count+0, rss+0 }
  ')
  if [[ ! $available =~ ^[0-9]+$ || $label != cpu || ! $cpu_user =~ ^[0-9]+$ ||
        ! $cpu_nice =~ ^[0-9]+$ || ! $cpu_system =~ ^[0-9]+$ ||
        ! $cpu_idle =~ ^[0-9]+$ || ! $cpu_iowait =~ ^[0-9]+$ ||
        ! $cpu_irq =~ ^[0-9]+$ || ! $cpu_softirq =~ ^[0-9]+$ ||
        ! $cpu_steal =~ ^[0-9]+$ || ! $runnable =~ ^[0-9]+$ ||
        ! $online_cpus =~ ^[0-9]+$ ]]; then
    echo 'Runner memory or CPU counters are unavailable.' >&2
    exit 1
  fi
  total=$((cpu_user + cpu_nice + cpu_system + cpu_idle + cpu_iowait + cpu_irq + cpu_softirq + cpu_steal))
  busy=$((cpu_user + cpu_nice + cpu_system + cpu_irq + cpu_softirq))
  idle_iowait=$((cpu_idle + cpu_iowait))
  busy_pct=''
  steal_pct=''
  if (( previous_total > 0 && total > previous_total )); then
    delta_total=$((total - previous_total))
    delta_busy=$((busy - previous_busy))
    delta_steal=$((cpu_steal - previous_steal))
    if (( delta_busy >= 0 && delta_steal >= 0 && delta_busy + delta_steal <= delta_total )); then
      busy_pct=$(awk -v used="$delta_busy" -v total="$delta_total" 'BEGIN { printf "%.1f", 100 * used / total }')
      steal_pct=$(awk -v used="$delta_steal" -v total="$delta_total" 'BEGIN { printf "%.1f", 100 * used / total }')
    fi
  fi
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$(date +%s)" "$available" \
    "$processes" "$rss" "$busy_pct" "$steal_pct" "$runnable" "$online_cpus" \
    "$total" "$idle_iowait" "$cpu_steal" >> "$output"
  previous_total=$total
  previous_busy=$busy
  previous_steal=$cpu_steal
  sleep 5
done

if [ "$(wc -l < "$output")" -lt 2 ]; then
  echo 'No client-runner samples were recorded.' >&2
  exit 1
fi
