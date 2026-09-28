/**
 * Durable state.
 *
 * `bun:sqlite` is SYNCHRONOUS, which is why the lobby layer reads like the
 * matcher rather than like a database client: there is no connection pool, no
 * second service and no `await` anywhere in here. That is also what lets the
 * tests run against `:memory:` and still exercise the real schema and the real
 * constraints, rather than a hand-rolled fake that cannot reproduce a race.
 *
 * Queue state is NOT here. Buckets are in-memory and die with the socket — that
 * is the whole premise. Only post-match state is durable.
 */

import { Database } from "bun:sqlite";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  account_id    TEXT PRIMARY KEY,
  -- Self-declared, exactly like mastery rank: DE exposes no player API, so
  -- nothing here is verified and nothing gates on it.
  ign           TEXT,
  platform      TEXT,
  mastery_rank  INTEGER,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS lobbies (
  lobby_id        TEXT PRIMARY KEY,
  share_code      TEXT NOT NULL UNIQUE,
  bucket_key      TEXT NOT NULL,
  -- Fixed at creation from the gate. There is no host handoff: if the host goes
  -- AFK, members press Queue again. A live role transfer was rejected as
  -- overcomplication.
  host_account_id TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  closed_at       INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS lobby_members (
  lobby_id      TEXT NOT NULL REFERENCES lobbies(lobby_id),
  account_id    TEXT NOT NULL,
  slot          INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 3),
  -- Copied from the in-memory entry at fire time, because the bucket is gone by
  -- the time this row is written and the wait time is worth keeping.
  enqueued_at   INTEGER NOT NULL,
  matched_at    INTEGER NOT NULL,
  left_at       INTEGER,
  -- Unused until the Good squad button (T10). A nullable column costs nothing
  -- now and saves a migration then.
  good_squad_at INTEGER,
  PRIMARY KEY (lobby_id, account_id)
) STRICT;

-- CAPACITY IS ENFORCED HERE, NOT IN APPLICATION LOGIC.
--
-- "Read the member count, then insert" is a race: two people entering the same
-- code for a 3/4 lobby both read three and both insert, producing a
-- five-person squad that cannot open a relic together. With four slots and a
-- CHECK bounding them, a fifth insert must collide with an occupied slot and
-- fail at the database. The caller translates that into "This squad is already
-- full" rather than surfacing the constraint.
--
-- The index is PARTIAL on left_at so a vacated slot becomes joinable again,
-- which is what T18 needs. Nothing vacates a slot yet.
CREATE UNIQUE INDEX IF NOT EXISTS lobby_members_slot
  ON lobby_members(lobby_id, slot) WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS lobby_members_account
  ON lobby_members(account_id) WHERE left_at IS NULL;

-- Append-only, none of it read in a hot path, and a future event type costs no
-- migration. match_fired, ready_gate_failed and radshare_successful are event
-- TYPES, not tables. There is no ratings table; reputation does not exist here.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS events_type_created ON events(type, created_at);
`;

export function openDatabase(path = ":memory:"): Database {
  const db = new Database(path);
  // WAL is the difference between a reader blocking a writer and not, and the
  // lobby read path runs on every reconnect.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export type EventType = "match_fired" | "ready_gate_failed" | "radshare_successful";

/** Append-only. Nothing reads these yet, and that is the intended state. */
export function recordEvent(
  db: Database,
  type: EventType,
  payload: Record<string, unknown>,
  now: number,
): void {
  db.query("INSERT INTO events (type, payload, created_at) VALUES (?, ?, ?)").run(
    type,
    JSON.stringify(payload),
    now,
  );
}
