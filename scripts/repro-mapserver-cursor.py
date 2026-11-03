#!/usr/bin/env python3
"""Reproduce v4.11.0's second-resolution SQLite cursor loss without a world."""

import sqlite3


database = sqlite3.connect(":memory:")


def fixed_second(format_string, value):
    if format_string != "%s" or value != "now":
        raise ValueError("unexpected SQLite clock request")
    return "1700000000"


# Freeze the second so the regression scenario is deterministic on slow CI hosts.
database.create_function("strftime", 2, fixed_second)
database.executescript(
    """
    create table blocks(pos integer primary key, data blob, mtime integer default 0);
    create trigger update_blocks_mtime_insert after insert on blocks for each row begin
      update blocks set mtime = strftime('%s', 'now') where pos = new.pos;
    end;
    create trigger update_blocks_mtime_update after update on blocks for each row begin
      update blocks set mtime = strftime('%s', 'now') where pos = old.pos;
    end;
    """
)
database.executemany(
    "insert into blocks(pos, data) values(?, ?)",
    ((position, b"x") for position in range(200)),
)


def next_batch(cursor):
    # This is v4.11.0's getBlocksByMtimeQueryLegacy predicate and ordering.
    return database.execute(
        "select pos, data, mtime from blocks where mtime > ? order by mtime asc limit ?",
        (cursor, 128),
    ).fetchall()


first = next_batch(0)
assert len(first) == 128
cursor = max(row[2] for row in first)
assert cursor == 1700000000
assert not next_batch(cursor)
database.execute("update blocks set data = ? where pos = ?", (b"y", first[0][0]))
assert not next_batch(cursor)
print("first batch: 128; skipped same-second rows: 72; same-second re-edit visible: no")
