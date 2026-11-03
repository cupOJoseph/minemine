import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const dayMs = 24 * 60 * 60 * 1000;
const validName = /^w_[a-f0-9]{17}$/;
const monthKey = date => date.toISOString().slice(0, 7);
const dayStart = date => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const weekStart = date => dayStart(date) - ((date.getUTCDay() + 6) % 7) * dayMs;

async function smallFile(file, maxBytes) {
  try {
    const info = await stat(file);
    if (info.size > maxBytes) throw new Error('Native player activity exceeded the configured read limit.');
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function createPlayerStats(worldDir, now = Date.now) {
  return async function playerStats(nativeReady) {
    const current = new Date(now());
    const today = dayStart(current);
    const week = weekStart(current);
    const month = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1);
    const periods = { daily: new Set(), weekly: new Set(), monthly: new Set() };
    const firstPrevious = new Date(month - dayMs);
    let earliest = null;
    for (const key of new Set([monthKey(current), monthKey(firstPrevious)])) {
      const raw = await smallFile(path.join(worldDir, `minemine-player-joins-${key}.log`), 4 * 1024 * 1024);
      if (raw === null) continue;
      for (const line of raw.split('\n')) {
        if (!line) continue;
        const match = /^(\d{10})\t(w_[a-f0-9]{17})$/.exec(line);
        if (!match || !validName.test(match[2])) continue;
        const time = Number(match[1]) * 1000;
        if (time > now() + 60_000 || monthKey(new Date(time)) !== key) continue;
        earliest = earliest === null ? time : Math.min(earliest, time);
        if (time >= month) periods.monthly.add(match[2]);
        if (time >= week) periods.weekly.add(match[2]);
        if (time >= today) periods.daily.add(match[2]);
      }
    }
    let players = [];
    let presenceFresh = false;
    if (nativeReady) {
      const raw = await smallFile(path.join(worldDir, 'minemine-player-presence.json'), 64 * 1024);
      if (raw !== null) {
        try {
          const snapshot = JSON.parse(raw);
          presenceFresh = Number.isInteger(snapshot.updated_at) &&
            Math.abs(now() - snapshot.updated_at * 1000) < 10_000 && Array.isArray(snapshot.players) &&
            snapshot.players.length <= 1000 && snapshot.players.every(name => validName.test(name));
          if (presenceFresh) players = [...new Set(snapshot.players)];
        } catch { /* A partial or invalid snapshot is never counted as current presence. */ }
      }
    }
    return {
      periods: { timezone: 'UTC', dayStart: new Date(today).toISOString(), weekStart: new Date(week).toISOString(), monthStart: new Date(month).toISOString() },
      current: { count: players.length, playerNames: players, fresh: presenceFresh },
      active: { daily: periods.daily.size, weekly: periods.weekly.size, monthly: periods.monthly.size },
      earliestScannedJoin: earliest === null ? null : new Date(earliest).toISOString(),
    };
  };
}

// The activity log contains stable character IDs only. This recent roster is
// deliberately bounded until a durable account/profile index exists.
export function createPlayerExplorer(worldDir, now = Date.now) {
  return async function playerExplorer(query = '', page = 1) {
    if (typeof query !== 'string' || query.length > 19 || !/^[a-z0-9_]*$/.test(query)) throw new Error('Invalid player search.');
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Invalid player page.');
    const current = new Date(now());
    const players = new Map();
    for (let offset = 0; offset < 12; offset++) {
      const key = monthKey(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - offset, 1)));
      const raw = await smallFile(path.join(worldDir, `minemine-player-joins-${key}.log`), 4 * 1024 * 1024);
      if (raw === null) continue;
      for (const line of raw.split('\n')) {
        const match = /^(\d{10})\t(w_[a-f0-9]{17})$/.exec(line);
        if (!match || !match[2].includes(query)) continue;
        const time = Number(match[1]) * 1000;
        if (time > now() + 60_000 || monthKey(new Date(time)) !== key) continue;
        const existing = players.get(match[2]);
        if (existing) {
          existing.firstSeen = Math.min(existing.firstSeen, time);
          existing.lastSeen = Math.max(existing.lastSeen, time);
          existing.joins++;
        } else players.set(match[2], { playerName: match[2], firstSeen: time, lastSeen: time, joins: 1 });
      }
    }
    const ordered = [...players.values()].sort((a, b) => b.lastSeen - a.lastSeen || a.playerName.localeCompare(b.playerName));
    const pageSize = 25;
    return {
      query, page, pageSize, total: ordered.length, windowMonths: 12,
      players: ordered.slice((page - 1) * pageSize, page * pageSize).map(player => ({
        ...player, firstSeen: new Date(player.firstSeen).toISOString(), lastSeen: new Date(player.lastSeen).toISOString(),
      })),
    };
  };
}
