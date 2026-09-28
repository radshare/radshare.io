/**
 * Board shapes on the wire.
 *
 * The PROJECTIONS live in `apps/server/src/board.ts` — this file is only the
 * vocabulary both ends share. A board is one surface with two modes, and the
 * mode is a function of queue state rather than of authentication.
 */

import type { BucketKey } from "./queue.ts";

export const GLOBAL_BOARD_LIMIT = 60;

/** Seconds the anonymous payload is reused. The row carries `updated Ns ago`. */
export const BOARD_CACHE_MS = 10_000;

export type BoardRow = {
  bucketKey: BucketKey;
  count: number;
};

export type BoardMode = "global" | "personal";

export type BoardSnapshot = {
  type: "board.snapshot";
  mode: BoardMode;
  rows: BoardRow[];
  /**
   * Non-empty buckets below the cap. Present on the global stream only — it is
   * how the board says "and 214 more" without shipping 214 rows.
   */
  hiddenCount?: number;
  /**
   * The viewer's OWN buckets, sent on every snapshot regardless of mode.
   *
   * This is what makes the mode correct by construction on every connect path.
   * Queue entries are account-keyed and survive a socket swap, so after a
   * refresh, a second tab, or a phone opened beside the desktop, a new socket
   * arrives with live queue entries while the client knows nothing about them
   * and would render the global board. Re-sending `queue.join` from
   * `localStorage` would fix the display and silently reset `enqueuedAt`,
   * costing the user their place in line on every refresh. One field avoids it.
   */
  you: { buckets: BoardRow[] };
  /** Epoch ms the projection was taken, so the client can render `updated Ns ago`. */
  at: number;
};

export type BoardDeltaRow = {
  bucketKey: BucketKey;
  count: number;
  /**
   * False means the row should be REMOVED: the bucket emptied, or it fell out
   * of the top 60. Without it the client renders a stale row forever.
   *
   * Always true on the own-buckets stream, where every delta concerns a bucket
   * you are in.
   */
  inBoard: boolean;
};

export type BoardDelta = {
  type: "board.delta";
  mode: BoardMode;
  rows: BoardDeltaRow[];
  hiddenCount?: number;
};
