/**
 * Board state as a pure reducer — this is where an off-by-one strands a row on
 * screen, and a reducer is tested by calling it rather than opening a socket.
 *
 * The server sends a SNAPSHOT on a mode flip and a DELTA otherwise.
 */

import type { BoardDelta, BoardMode, BoardRow, BoardSnapshot } from "@radshare/protocol";

export type BoardState = {
  mode: BoardMode;
  rows: BoardRow[];
  /** Global mode only. */
  hiddenCount: number;
  /** Whatever the mode. Drives "am I queued?". */
  you: BoardRow[];
  /** For `updated Ns ago`. */
  at: number;
};

export const EMPTY_BOARD: BoardState = {
  mode: "global",
  rows: [],
  hiddenCount: 0,
  you: [],
  at: 0,
};

export function applySnapshot(msg: BoardSnapshot): BoardState {
  return {
    mode: msg.mode,
    rows: [...msg.rows],
    hiddenCount: msg.hiddenCount ?? 0,
    you: [...msg.you.buckets],
    at: msg.at,
  };
}

/**
 * `inBoard: false` REMOVES the row; treating it as `count: 0` would render
 * `0/4`, which is unreachable.
 *
 * A delta whose mode disagrees is dropped rather than merged — it should not
 * happen, but merging personal rows into a global board would corrupt the
 * count a stranger is reading.
 */
export function applyDelta(state: BoardState, msg: BoardDelta, at: number): BoardState {
  if (msg.mode !== state.mode) return state;

  const byKey = new Map(state.rows.map((r) => [r.bucketKey, r]));
  for (const row of msg.rows) {
    if (row.inBoard) byKey.set(row.bucketKey, { bucketKey: row.bucketKey, count: row.count });
    else byKey.delete(row.bucketKey);
  }

  const rows = sortRows([...byKey.values()]);
  return {
    mode: state.mode,
    rows,
    hiddenCount: msg.hiddenCount ?? state.hiddenCount,
    you: msg.mode === "personal" ? rows : state.you,
    at,
  };
}

/**
 * Fill descending, then key. The server's real tiebreak is bucket AGE, which
 * the wire does not carry; the key keeps the order stable instead, and a board
 * that reshuffles every tick is unreadable even when every number is right.
 */
export function sortRows(rows: BoardRow[]): BoardRow[] {
  return [...rows].sort(
    (a, b) => b.count - a.count || (a.bucketKey < b.bucketKey ? -1 : a.bucketKey > b.bucketKey ? 1 : 0),
  );
}

export function isQueued(state: BoardState): boolean {
  return state.you.length > 0;
}

// ---------------------------------------------------------------------------
// reconnection
// ---------------------------------------------------------------------------

export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 15_000;

/**
 * Capped, because the user is sitting in front of a board that stopped being
 * true and a client backed off to two minutes looks like one that gave up.
 */
export function backoffMs(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
}

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

/**
 * The board MUST visibly disown its numbers the moment the socket is gone. An
 * undimmed board during a dropped connection is the app lying about the only
 * thing it promises.
 */
export function countsAreLive(connection: ConnectionState): boolean {
  return connection === "live";
}
