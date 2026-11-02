#!/usr/bin/env bash
set -euo pipefail

test -x runtime/host-caddy/caddy
test -f public/engine/adapter.js
test -f public/engine/index.html
test -f runtime/native-world/world.mt
cp -a runtime/native-world runtime/host-world
rm -f runtime/host-world/minemine-server-heartbeat
mkdir -p runtime/host-caddy-data runtime/host-caddy-config
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const template = readFileSync('deploy/vps/Caddyfile.example', 'utf8');
const host = 'play.203.0.113.10.sslip.io {';
const upstream = 'reverse_proxy 127.0.0.1:3000 {';
if (template.split(host).length !== 2 || template.split(upstream).length !== 2) throw new Error('Deployment Caddyfile changed; review the host rehearsal.');
writeFileSync('runtime/host-Caddyfile', '{\n    admin off\n    auto_https disable_redirects\n}\n' +
  template.replace(host, 'https://127.0.0.1:18443 {\n    tls internal')
    .replace(upstream, 'reverse_proxy 127.0.0.1:18082 {'));
EOF
export XDG_DATA_HOME="$GITHUB_WORKSPACE/runtime/host-caddy-data"
export XDG_CONFIG_HOME="$GITHUB_WORKSPACE/runtime/host-caddy-config"
runtime/host-caddy/caddy validate --config runtime/host-Caddyfile --adapter caddyfile > runtime/host-caddy-validate.log 2>&1

native_pid=''
api_pid=''
caddy_pid=''
cleanup() {
  for pid in "$caddy_pid" "$api_pid" "$native_pid"; do
    if [ -n "$pid" ]; then kill -INT "$pid" 2>/dev/null || true; fi
  done
  for pid in "$caddy_pid" "$api_pid" "$native_pid"; do
    if [ -n "$pid" ]; then wait "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT

(
  cd vendor/native
  exec bin/luantiserver --info --world "$GITHUB_WORKSPACE/runtime/host-world" \
    --config "$GITHUB_WORKSPACE/game/minetest.conf" \
    --logfile "$GITHUB_WORKSPACE/runtime/host-native.log"
) > runtime/host-native-console.log 2>&1 &
native_pid=$!
PUBLIC_ORIGIN=https://127.0.0.1:18443 HOST=127.0.0.1 PORT=18082 \
  TRUST_LOOPBACK_PROXY=true WORLD_DIR="$GITHUB_WORKSPACE/runtime/host-world" \
  GAME_ENABLED=true ENGINE_ADAPTER_READY=true \
  "${NODE_BINARY:-node}" server/index.mjs > runtime/host-api-console.log 2>&1 &
api_pid=$!
runtime/host-caddy/caddy run --config runtime/host-Caddyfile --adapter caddyfile \
  > runtime/host-caddy-console.log 2>&1 &
caddy_pid=$!

ready=0
for attempt in {1..60}; do
  root=$(find "$XDG_DATA_HOME" -name root.crt -print -quit 2>/dev/null)
  if [ -n "$root" ] && curl --fail --silent --show-error --cacert "$root" \
      https://127.0.0.1:18443/api/health -o runtime/host-api-health.json 2>/dev/null &&
      grep -Fq '"gameReady":true' runtime/host-api-health.json; then
    ready=1
    break
  fi
  for pid in "$native_pid" "$api_pid" "$caddy_pid"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      cat runtime/host-native-console.log runtime/host-api-console.log runtime/host-caddy-console.log
      echo 'A host-stack service exited before HTTPS readiness.'
      exit 1
    fi
  done
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  cat runtime/host-native-console.log runtime/host-api-console.log runtime/host-caddy-console.log
  echo 'The one-core HTTPS host stack did not become game-ready.'
  exit 1
fi

HOST_REHEARSAL_ORIGIN=https://127.0.0.1:18443 HOST_REHEARSAL_CA="$root" \
  "${NODE_BINARY:-node}" test/integration/host-proxy.mjs
release=$(node -p "JSON.parse(require('fs').readFileSync('public/engine/build.json', 'utf8')).release")
curl --fail --silent --show-error --cacert "$root" -H 'Accept-Encoding: zstd' \
  -D runtime/host-wasm-headers.txt -o /dev/null \
  "https://127.0.0.1:18443/engine/${release}/luanti.wasm"
grep -iq '^content-encoding: zstd' runtime/host-wasm-headers.txt
grep -iq '^content-type: application/wasm' runtime/host-wasm-headers.txt
printf 'One-core host stack served CA-verified HTTPS/WSS and compressed WASM; native world stayed game-ready.\n'
