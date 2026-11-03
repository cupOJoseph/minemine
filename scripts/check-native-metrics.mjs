import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const world = path.resolve(process.env.WORLD_DIR || 'runtime/world');
const file = path.join(world, 'minemine-native-metrics.json');
const stat = statSync(file);
const ageSeconds = (Date.now() - stat.mtimeMs) / 1000;
assert.ok(ageSeconds >= 0 && ageSeconds <= 30, `Native metrics snapshot is stale (${ageSeconds.toFixed(1)}s).`);

const metrics = JSON.parse(readFileSync(file, 'utf8'));
assert.equal(metrics.schema, 1);
for (const key of ['observed_at', 'sample_seconds', 'samples', 'online_players',
  'step_interval_ms_mean', 'step_interval_ms_p50', 'step_interval_ms_p95',
  'step_interval_ms_p99', 'step_interval_ms_max']) {
  assert.ok(Number.isFinite(metrics[key]), `Invalid native metrics field: ${key}`);
}
assert.ok(metrics.sample_seconds > 0 && metrics.samples > 0);
assert.ok(Number.isInteger(metrics.online_players) && metrics.online_players >= 0);
assert.ok(metrics.step_interval_ms_mean >= 0 && metrics.step_interval_ms_mean <= metrics.step_interval_ms_max);
assert.ok(metrics.step_interval_ms_p50 <= metrics.step_interval_ms_p95);
assert.ok(metrics.step_interval_ms_p95 <= metrics.step_interval_ms_p99);
assert.ok(metrics.step_interval_ms_p99 <= metrics.step_interval_ms_max);
if (metrics.server_max_lag_ms != null) {
  assert.ok(Number.isFinite(metrics.server_max_lag_ms) && metrics.server_max_lag_ms >= 0);
}
console.log(JSON.stringify({ ...metrics, snapshot_age_seconds: Number(ageSeconds.toFixed(2)) }));
