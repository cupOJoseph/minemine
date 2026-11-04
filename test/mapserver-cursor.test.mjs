import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

// The pinned mapserver v4.11.0 SQLite accessor selects `mtime > cursor`,
// sorts only by mtime and limits each batch. Its trigger writes Unix seconds.
// Reproduce that source behavior with the 343 writes / 128 fetch from the
// retained native CI run 41381094397. This documents an upstream defect;
// it is not a test of a MineMine fix.
test('pinned mapserver cursor can skip writes sharing a second', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE blocks (x INTEGER PRIMARY KEY, mtime INTEGER NOT NULL)');
    const add = db.prepare('INSERT INTO blocks (x, mtime) VALUES (?, ?)');
    const timestamp = 1793589325;
    for (let x = 0; x < 343; x++) add.run(x, timestamp);

    const fetch = db.prepare('SELECT x, mtime FROM blocks WHERE mtime > ? ORDER BY mtime ASC LIMIT ?');
    const first = fetch.all(timestamp - 1, 128);
    assert.equal(first.length, 128);
    const cursor = first.at(-1).mtime;
    const second = fetch.all(cursor, 128);
    assert.equal(second.length, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM blocks WHERE mtime = ?').get(cursor).n - first.length, 215);
  } finally {
    db.close();
  }
});
