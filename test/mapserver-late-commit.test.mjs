import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// A timestamp/position cursor can pass a mapblock whose write is still in an
// open transaction. SQLite hides that write until commit, even though its
// trigger assigned the same second as an already committed mapblock.
test('a delayed commit lands behind the bounded mtime/position cursor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'minemine-map-cursor-'));
  const filename = join(dir, 'world.sqlite');
  const writer = new DatabaseSync(filename);
  const reader = new DatabaseSync(filename);
  try {
    writer.exec('PRAGMA journal_mode=WAL');
    writer.exec('CREATE TABLE blocks (pos INTEGER PRIMARY KEY, data TEXT, mtime INTEGER NOT NULL)');
    writer.exec('INSERT INTO blocks VALUES (200, \'old\', 1000)');

    writer.exec('BEGIN IMMEDIATE');
    writer.exec('INSERT INTO blocks VALUES (100, \'late\', 1000)');
    const page = reader.prepare(`
      SELECT pos, mtime FROM blocks
      WHERE (mtime, pos) > (?, ?) AND mtime < ?
      ORDER BY mtime, pos LIMIT ?
    `);
    const first = page.all(999, -1, 1001, 128);
    assert.deepEqual(first.map((row) => row.pos), [200]);
    writer.exec('COMMIT');
    assert.deepEqual(page.all(1000, 200, 1001, 128), []);
    assert.equal(reader.prepare('SELECT COUNT(*) AS n FROM blocks').get().n, 2);
  } finally {
    reader.close();
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// An indexed dirty-block queue avoids the timestamp race and stays bounded by
// the number of distinct unprocessed positions. Its sequence is assigned in
// the same SQLite write transaction as each block change.
test('a transactional dirty-block sequence sees the delayed commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'minemine-map-sequence-'));
  const filename = join(dir, 'world.sqlite');
  const writer = new DatabaseSync(filename);
  const reader = new DatabaseSync(filename);
  try {
    writer.exec('PRAGMA journal_mode=WAL');
    writer.exec(`
      CREATE TABLE blocks (pos INTEGER PRIMARY KEY, data TEXT, mtime INTEGER NOT NULL);
      CREATE TABLE mapserver_counter (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL);
      INSERT INTO mapserver_counter VALUES (1, 0);
      CREATE TABLE mapserver_dirty (pos INTEGER PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE INDEX mapserver_dirty_seq ON mapserver_dirty(seq);
      CREATE TRIGGER mapserver_dirty_insert AFTER INSERT ON blocks BEGIN
        UPDATE mapserver_counter SET seq = seq + 1 WHERE id = 1;
        INSERT OR REPLACE INTO mapserver_dirty(pos, seq)
          VALUES (NEW.pos, (SELECT seq FROM mapserver_counter WHERE id = 1));
      END;
      CREATE TRIGGER mapserver_dirty_update AFTER UPDATE OF data ON blocks BEGIN
        UPDATE mapserver_counter SET seq = seq + 1 WHERE id = 1;
        INSERT OR REPLACE INTO mapserver_dirty(pos, seq)
          VALUES (NEW.pos, (SELECT seq FROM mapserver_counter WHERE id = 1));
      END;
    `);
    const next = reader.prepare('SELECT pos, seq FROM mapserver_dirty WHERE seq > ? ORDER BY seq LIMIT ?');
    writer.exec('INSERT INTO blocks VALUES (200, \'old\', 1000)');
    writer.exec('BEGIN IMMEDIATE');
    writer.exec('INSERT INTO blocks VALUES (100, \'late\', 1000)');
    const first = next.all(0, 128);
    assert.deepEqual(first.map((row) => row.pos), [200]);
    writer.exec('COMMIT');
    assert.deepEqual(next.all(first.at(-1).seq, 128).map((row) => row.pos), [100]);

    // Pruning an earlier page must preserve a newer update to that position.
    writer.exec("UPDATE blocks SET data = 'new' WHERE pos = 200");
    writer.prepare('DELETE FROM mapserver_dirty WHERE seq <= ?').run(first.at(-1).seq);
    assert.deepEqual(next.all(first.at(-1).seq, 128).map((row) => row.pos), [100, 200]);
    assert.equal(reader.prepare('SELECT COUNT(*) AS n FROM mapserver_dirty').get().n, 2);
  } finally {
    reader.close();
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
