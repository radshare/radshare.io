/**
 * Durable state. `bun:sqlite` is synchronous, so the lobby layer reads like the
 * matcher and the tests run the REAL schema against `:memory:` rather than a
 * fake that cannot reproduce a race.
 *
 * Queue state is not here — buckets die with the socket. Only post-match state.
 */

import { Database } from "bun:sqlite";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  account_id    TEXT PRIMARY KEY,
  -- REQUIRED and never blank, though unverified. The product ends in a host
  -- typing this into Warframe, so an account without one cannot be invited.
  -- Enforced here rather than in a form, so no code path can skip it.
  ign           TEXT NOT NULL CHECK (length(trim(ign)) > 0),
  platform      TEXT,
  mastery_rank  INTEGER,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS lobbies (
  lobby_id        TEXT PRIMARY KEY,
  share_code      TEXT NOT NULL UNIQUE,
  bucket_key      TEXT NOT NULL,
  -- Fixed at creation. No host handoff: an AFK host means Queue again.
  host_account_id TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  closed_at       INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS lobby_members (
  lobby_id      TEXT NOT NULL REFERENCES lobbies(lobby_id),
  -- Carries the IGN guarantee into this table, so the lobby view can JOIN
  -- rather than LEFT JOIN.
  account_id    TEXT NOT NULL REFERENCES accounts(account_id),
  slot          INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 3),
  -- Copied at fire time: the bucket is gone by the time this row is written.
  enqueued_at   INTEGER NOT NULL,
  matched_at    INTEGER NOT NULL,
  left_at       INTEGER,
  -- Unused until the Good squad button. Cheaper than a migration later.
  good_squad_at INTEGER,
  PRIMARY KEY (lobby_id, account_id)
) STRICT;

-- CAPACITY IS ENFORCED HERE, NOT IN APPLICATION LOGIC.
--
-- "Read the count, then insert" is a race: two people entering the same code
-- for a 3/4 lobby both read three and both insert, producing a five-person
-- squad that cannot open a relic. With four bounded slots the fifth insert
-- must collide and fail here.
--
-- PARTIAL on left_at so a vacated slot frees up. Nothing vacates one yet.
CREATE UNIQUE INDEX IF NOT EXISTS lobby_members_slot
  ON lobby_members(lobby_id, slot) WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS lobby_members_account
  ON lobby_members(account_id) WHERE left_at IS NULL;

-- Append-only. match_fired, ready_gate_failed and radshare_successful are
-- event TYPES, not tables, so a new one costs no migration. There is no
-- ratings table; reputation does not exist in this product.
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
  // The lobby read path runs on every reconnect.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export type EventType = "match_fired" | "ready_gate_failed" | "radshare_successful";

/** Nothing reads these yet, and that is the intended state. */
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
