/**
 * Board state on the client, as a pure reducer.
 *
 * Kept separate from the socket for the same reason the matcher is kept
 * separate from the server: this is where an off-by-one strands a row on
 * screen, and a reducer can be tested by calling it rather than by opening a
 * connection and waiting.
 *
 * The server sends a SNAPSHOT when the mode flips and a DELTA otherwise, so
 * this has to handle both without knowing which is coming.
 */

import type { BoardDelta, BoardMode, BoardRow, BoardSnapshot } from "@radshare/protocol";

export type BoardState = {
  mode: BoardMode;
  rows: BoardRow[];
  /** Non-empty buckets below the top 60. Global mode only. */
  hiddenCount: number;
  /** The viewer's own buckets, whatever the mode. Drives "am I queued?". */
  you: BoardRow[];
  /** Epoch ms of the last server projection, for `updated Ns ago`. */
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
 * Applies a delta.
 *
 * `inBoard: false` REMOVES the row — the bucket emptied, or it fell off the
 * bottom of the top 60. Treating it as `count: 0` instead would render `0/4`,
 * which is not a state the system can be in.
 *
 * A delta whose mode disagrees with the current state is dropped rather than
 * merged. That should not happen — the server sends a snapshot on a flip — but
 * merging personal rows into a global board would silently corrupt the count a
 * stranger is reading.
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
 * Fill descending, then bucket key.
 *
 * The server's real tiebreak is bucket AGE, which the wire does not carry — a
 * row's age is not something the client can know. Sorting by key keeps the
 * order stable and deterministic between updates, which is what matters here:
 * a board that reshuffles on every tick is unreadable even when every number
 * on it is right.
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
 * Exponential backoff, capped.
 *
 * Capped rather than unbounded because the user is sitting in front of a board
 * that has stopped being true, and a client that has backed off to two minutes
 * is indistinguishable from one that gave up. Fifteen seconds is the longest
 * anyone should stare at a dimmed board after the network returns.
 */
export function backoffMs(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
}

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

/**
 * Whether the counts on screen can still be vouched for.
 *
 * The board MUST visibly disown its numbers the moment the socket is gone. An
 * undimmed board during a dropped connection is the app lying about the only
 * thing it promises, and it is the one failure that would cost the product its
 * reason to exist.
 */
export function countsAreLive(connection: ConnectionState): boolean {
  return connection === "live";
}
