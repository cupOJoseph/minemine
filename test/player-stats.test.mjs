import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPlayerStats } from '../server/player-stats.mjs';

const name = letter => `w_${letter.repeat(17)}`;

test('native joins produce distinct UTC day, week and month counts, while stale presence is never live', async t => {
  const world = mkdtempSync(path.join(tmpdir(), 'minemine-stats-'));
  t.after(() => rmSync(world, { recursive: true, force: true }));
  const now = Date.parse('2026-11-01T12:00:00Z');
  const line = (date, player) => `${Math.floor(Date.parse(date) / 1000)}\t${player}\n`;
  writeFileSync(path.join(world, 'minemine-player-joins-2026-10.log'),
    line('2026-10-25T23:59:59Z', name('a')) +
    line('2026-10-26T00:00:00Z', name('b')) +
    line('2026-10-31T23:59:59Z', name('b')) +
    'malformed\n');
  writeFileSync(path.join(world, 'minemine-player-joins-2026-11.log'),
    line('2026-11-01T00:00:00Z', name('c')) +
    line('2026-11-01T11:00:00Z', name('c')) +
    line('2026-11-02T00:00:00Z', name('d')));
  writeFileSync(path.join(world, 'minemine-player-presence.json'), JSON.stringify({
    updated_at: now / 1000, players: [name('b'), name('c')],
  }));
  const stats = createPlayerStats(world, () => now);
  const value = await stats(true);
  assert.deepEqual(value.active, { daily: 1, weekly: 2, monthly: 1 });
  assert.deepEqual(value.current, { count: 2, playerNames: [name('b'), name('c')], fresh: true });
  assert.equal(value.periods.weekStart, '2026-10-26T00:00:00.000Z');
  assert.equal(value.periods.monthStart, '2026-11-01T00:00:00.000Z');
  assert.equal(value.earliestScannedJoin, '2026-10-25T23:59:59.000Z');
  assert.deepEqual((await stats(false)).current, { count: 0, playerNames: [], fresh: false });
  writeFileSync(path.join(world, 'minemine-player-presence.json'), JSON.stringify({
    updated_at: now / 1000 - 11, players: [name('b')],
  }));
  assert.equal((await stats(true)).current.count, 0);
});
