/**
 * The board.
 *
 * ONE surface with two modes, and **the mode is a function of queue state, not
 * of authentication**. Unqueued you see the global board; queued you see your
 * own buckets; leaving the queue swaps back. That is what stops anyone ever
 * facing an empty screen — an unqueued user always has the global board — while
 * still giving the rare-relic user a view of just their own the instant they
 * commit.
 *
 * Content follows queue state. Transport follows authentication. Two axes:
 *
 *               | global board                  | your own buckets
 *   ------------|-------------------------------|------------------
 *   anonymous   | cached GET, 10s               | n/a, cannot queue
 *   signed in   | live over the socket          | live over the socket
 *
 * Signed-in users get the GLOBAL board live, not on the cache. Watching a
 * bucket reach 3/4 is what prompts someone to join it, and a ten-second delay
 * blunts the one mechanism that completes other people's squads.
 *
 * Synchronous and time-injected, like everything else here. A board is a pure
 * projection of the bucket map; nothing in this file owns state except the
 * per-client record of what was last sent.
 */

import type { AccountId, BucketKey, Buckets } from "@radshare/protocol";

/**
 * The global board is capped at the top 60. Beyond that the page is a wall of
 * `1/4` commons, and the rows that matter — the nearly-full ones — are already
 * at the top by definition.
 */
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

// ---------------------------------------------------------------------------
// projections
// ---------------------------------------------------------------------------

/**
 * Every non-empty bucket, fill descending then bucket age, capped.
 *
 * A bucket's age is its oldest entry — buckets are created by their first
 * joiner and deleted on last removal, so that entry IS the bucket's birth. The
 * tiebreak rewards the bucket that has been waiting, which is the same
 * principle as the matcher's FIFO. `bucketKey` breaks the remaining tie so the
 * order is total and the board never reshuffles between identical states.
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

/**
 * The buckets this account is in, in the same order the global board would use.
 *
 * Never empty while queued: queueing creates your bucket with you in it, so it
 * is never below `1/4` and `0/4` is not a state this system can be in.
 */
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

/** True once the account holds any entry. This is what picks the mode. */
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
 * What one signed-in socket is subscribed to.
 *
 * `queue.join` and `queue.leave` swap the subscription rather than opening a
 * second one, and the swap is the visible confirmation that queueing worked —
 * the only feedback a user gets when no match fires immediately.
 *
 * The stream remembers which rows the client currently has so it can say
 * `inBoard: false` when one falls off the global board. Without that memory the
 * client cannot distinguish "unchanged" from "gone".
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
   * Full state, and the only message that sets the mode.
   *
   * The mode is read from the buckets rather than from a client claim, so a
   * reconnect while queued lands in personal mode without the client having to
   * know it was queued.
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
   * What changed since the last snapshot or delta on THIS stream.
   *
   * Recomputes the projection rather than trusting a list of touched keys: one
   * bucket growing can push another off the bottom of the top 60, and that
   * second bucket was never "touched". At board scale the sort is cheap and
   * being right is worth more than being clever.
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
 * `GET /api/board`, on a 10-second cache.
 *
 * A hundred anonymous readers cost one cached projection rather than a hundred
 * live connections, and the same payload is server-rendered into first paint so
 * a visitor from Reddit sees a populated board before JavaScript runs. A
 * ten-second board is still honest: the row carries `updated Ns ago`, which is
 * what `at` is for.
 *
 * Anonymous viewers never hold a socket, so there is no `you` here — they
 * cannot queue and have no buckets of their own.
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

  /** Age in seconds, for the `updated Ns ago` the row carries. */
  static ageSeconds(board: CachedBoard, now: number): number {
    return Math.max(0, Math.floor((now - board.at) / 1000));
  }
}
