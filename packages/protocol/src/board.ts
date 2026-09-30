/**
 * Board shapes on the wire. The projections live in `apps/server/src/board.ts`.
 *
 * One surface, two modes, and the mode follows queue state rather than auth.
 */

import type { BucketKey } from "./queue.ts";

/** Beyond the top 60 the page is a wall of `1/4` commons. */
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
  /** Non-empty buckets below the cap. Global stream only. */
  hiddenCount?: number;
  /**
   * The viewer's own buckets, on EVERY snapshot regardless of mode.
   *
   * Without it a second tab or a phone opened beside the desktop arrives with
   * live queue entries and renders the global board. Fixing that by re-sending
   * `queue.join` would silently reset `enqueuedAt`.
   */
  you: { buckets: BoardRow[] };
  /** Epoch ms the projection was taken, so the client can render `updated Ns ago`. */
  at: number;
};

export type BoardDeltaRow = {
  bucketKey: BucketKey;
  count: number;
  /**
   * False means REMOVE the row — emptied, or fell out of the top 60. Without it
   * the client renders a stale row forever. Always true on the personal stream.
   */
  inBoard: boolean;
};

export type BoardDelta = {
  type: "board.delta";
  mode: BoardMode;
  rows: BoardDeltaRow[];
  hiddenCount?: number;
};
