/**
 * The board. One surface, two modes, and the mode follows QUEUE STATE rather
 * than authentication — so an unqueued user always has the global board and
 * nobody ever faces an empty screen.
 *
 *               | global                | your own buckets
 *   anonymous   | cached GET, 10s       | n/a, cannot queue
 *   signed in   | live over the socket  | live over the socket
 *
 * Signed-in users get the global board LIVE, not cached: watching a bucket
 * reach 3/4 is what prompts someone to join it.
 */

import {
  BOARD_CACHE_MS,
  GLOBAL_BOARD_LIMIT,
  type AccountId,
  type BoardDelta,
  type BoardDeltaRow,
  type BoardMode,
  type BoardRow,
  type BoardSnapshot,
  type BucketKey,
  type Buckets,
} from "@radshare/protocol";

/**
 * The global board is capped at the top 60. Beyond that the page is a wall of
 * `1/4` commons, and the rows that matter — the nearly-full ones — are already
 * at the top by definition.
 */
export { BOARD_CACHE_MS, GLOBAL_BOARD_LIMIT };
export type { BoardDelta, BoardDeltaRow, BoardMode, BoardRow, BoardSnapshot };

// ---------------------------------------------------------------------------
// projections
// ---------------------------------------------------------------------------

/**
 * Fill descending, then bucket age, capped.
 *
 * A bucket's oldest entry IS its birth, since the first joiner creates it. The
 * key breaks the remaining tie so the order is total and the board never
 * reshuffles between identical states.
 */
export function globalBoard(buckets: Buckets, limit = GLOBAL_BOARD_LIMIT): {
  rows: BoardRow[];
  hiddenCount: number;
} {
  const all = [...buckets.entries()]
    .filter(([, bucket]) => bucket.length > 0)
    .sort(([aKey, a], [bKey, b]) => {
      if (b.length !== a.length) return b.length - a.length;
      const aAge = a[0]!.enqueuedAt;
      const bAge = b[0]!.enqueuedAt;
      if (aAge !== bAge) return aAge - bAge;
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });

  return {
    rows: all.slice(0, limit).map(([bucketKey, bucket]) => ({ bucketKey, count: bucket.length })),
    hiddenCount: Math.max(0, all.length - limit),
  };
}

/** Never below `1/4`: queueing creates the bucket with you already in it. */
export function personalBoard(buckets: Buckets, accountId: AccountId): BoardRow[] {
  const mine: [BucketKey, number, number][] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.some((e) => e.accountId === accountId)) {
      mine.push([key, bucket.length, bucket[0]!.enqueuedAt]);
    }
  }
  mine.sort((a, b) => b[1] - a[1] || a[2] - b[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return mine.map(([bucketKey, count]) => ({ bucketKey, count }));
}

/** What picks the mode. */
export function isQueued(buckets: Buckets, accountId: AccountId): boolean {
  for (const bucket of buckets.values()) {
    if (bucket.some((e) => e.accountId === accountId)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// per-client streams
// ---------------------------------------------------------------------------

/**
 * What one socket is subscribed to. `queue.join` / `queue.leave` swap it.
 *
 * Remembers which rows the client holds, so it can say `inBoard: false` when
 * one falls off — otherwise the client cannot tell "unchanged" from "gone".
 */
export class BoardStream {
  #mode: BoardMode = "global";
  #visible = new Set<BucketKey>();

  constructor(
    private readonly accountId: AccountId,
    private readonly limit = GLOBAL_BOARD_LIMIT,
  ) {}

  get mode(): BoardMode {
    return this.#mode;
  }

  /**
   * Full state. The mode comes from the buckets, never from a client claim, so
   * a reconnect while queued lands in personal mode unprompted.
   */
  snapshot(buckets: Buckets, now: number): BoardSnapshot {
    const mine = personalBoard(buckets, this.accountId);
    this.#mode = mine.length > 0 ? "personal" : "global";

    if (this.#mode === "personal") {
      this.#visible = new Set(mine.map((r) => r.bucketKey));
      return {
        type: "board.snapshot",
        mode: "personal",
        rows: mine,
        you: { buckets: mine },
        at: now,
      };
    }

    const { rows, hiddenCount } = globalBoard(buckets, this.limit);
    this.#visible = new Set(rows.map((r) => r.bucketKey));
    return {
      type: "board.snapshot",
      mode: "global",
      rows,
      hiddenCount,
      you: { buckets: mine },
      at: now,
    };
  }

  /**
   * A DELTA normally, a SNAPSHOT when the mode flipped.
   *
   * Global rows and your own rows are different sets, and no sequence of
   * per-row deltas says "replace the board". An earlier version set the mode
   * only in `snapshot()`, so hitting Queue left the user on the global board.
   */
  update(buckets: Buckets, now: number): BoardSnapshot | BoardDelta {
    const queued = isQueued(buckets, this.accountId);
    const next: BoardMode = queued ? "personal" : "global";
    if (next !== this.#mode) return this.snapshot(buckets, now);
    return this.delta(buckets);
  }

  /**
   * Recomputes the projection rather than trusting touched keys: one bucket
   * growing pushes another off the bottom, and that one was never touched.
   */
  delta(buckets: Buckets): BoardDelta {
    if (this.#mode === "personal") {
      const mine = personalBoard(buckets, this.accountId);
      const next = new Set(mine.map((r) => r.bucketKey));
      const rows: BoardDeltaRow[] = mine.map((r) => ({ ...r, inBoard: true }));
      for (const key of this.#visible) {
        if (!next.has(key)) rows.push({ bucketKey: key, count: 0, inBoard: false });
      }
      this.#visible = next;
      return { type: "board.delta", mode: "personal", rows };
    }

    const { rows: board, hiddenCount } = globalBoard(buckets, this.limit);
    const next = new Set(board.map((r) => r.bucketKey));
    const rows: BoardDeltaRow[] = board.map((r) => ({ ...r, inBoard: true }));
    for (const key of this.#visible) {
      if (!next.has(key)) rows.push({ bucketKey: key, count: 0, inBoard: false });
    }
    this.#visible = next;
    return { type: "board.delta", mode: "global", rows, hiddenCount };
  }
}

// ---------------------------------------------------------------------------
// the anonymous surface
// ---------------------------------------------------------------------------

/**
 * `GET /api/board`, on a 10-second cache: a hundred anonymous readers cost one
 * projection, and the same payload is server-rendered into first paint.
 *
 * Honest because `at` carries its age. No `you` field — they cannot queue.
 */
export type CachedBoard = {
  rows: BoardRow[];
  hiddenCount: number;
  at: number;
};

export class BoardCache {
  #cached: CachedBoard | null = null;

  constructor(private readonly ttlMs = BOARD_CACHE_MS) {}

  get(buckets: Buckets, now: number): CachedBoard {
    if (this.#cached && now - this.#cached.at < this.ttlMs) return this.#cached;
    const { rows, hiddenCount } = globalBoard(buckets);
    this.#cached = { rows, hiddenCount, at: now };
    return this.#cached;
  }

  /** For the `updated Ns ago` the row carries. */
  static ageSeconds(board: CachedBoard, now: number): number {
    return Math.max(0, Math.floor((now - board.at) / 1000));
  }
}
