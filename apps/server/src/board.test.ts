import { describe, expect, test } from "bun:test";
import { bucketKey, type BucketKey, type Buckets } from "@radshare/protocol";
import {
  BOARD_CACHE_MS,
  BoardCache,
  BoardStream,
  GLOBAL_BOARD_LIMIT,
  globalBoard,
  isQueued,
  personalBoard,
} from "./board.ts";
import { planMatch } from "./matcher.ts";

const AXI = bucketKey("Axi A2", "radiant");
const MESO = bucketKey("Meso B4", "radiant");
const LITH = bucketKey("Lith C1", "radiant");

/** Builds bucket state through the real matcher rather than by hand. */
function queue(entries: [AccountId: string, keys: BucketKey[], at: number][]): Buckets {
  const buckets: Buckets = new Map();
  for (const [accountId, selection, at] of entries) {
    const r = planMatch(buckets, { accountId, selection }, at);
    if (!r.ok) throw new Error(r.error);
  }
  return buckets;
}

describe("the global board", () => {
  test("is every non-empty bucket, fill descending", () => {
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [AXI], 1001],
      ["c", [AXI], 1002],
      ["d", [MESO], 1003],
      ["e", [MESO], 1004],
      ["f", [LITH], 1005],
    ]);
    expect(globalBoard(buckets).rows).toEqual([
      { bucketKey: AXI, count: 3 },
      { bucketKey: MESO, count: 2 },
      { bucketKey: LITH, count: 1 },
    ]);
  });

  test("breaks a fill tie on bucket age, oldest first", () => {
    const buckets = queue([
      ["a", [MESO], 1000],
      ["b", [AXI], 2000],
    ]);
    expect(globalBoard(buckets).rows.map((r) => r.bucketKey)).toEqual([MESO, AXI]);
  });

  test("breaks a remaining tie deterministically, so the board never reshuffles", () => {
    const buckets = queue([
      ["a", [MESO], 1000],
      ["b", [AXI], 1000],
    ]);
    const once = globalBoard(buckets).rows.map((r) => r.bucketKey);
    const twice = globalBoard(buckets).rows.map((r) => r.bucketKey);
    expect(once).toEqual(twice);
    expect(once).toEqual([AXI, MESO]);
  });

  test("never contains an empty bucket, because one cannot exist", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    planMatch(buckets, { accountId: "a", selection: [] }, 1100);
    expect(globalBoard(buckets).rows).toEqual([]);
    expect(buckets.has(AXI)).toBe(false);
  });

  test("caps at the top 60 and reports the rest as hidden", () => {
    const entries: [string, BucketKey[], number][] = [];
    for (let i = 0; i < 75; i += 1) {
      entries.push([`a${i}`, [bucketKey(`Relic ${i}`, "radiant")], 1000 + i]);
    }
    const { rows, hiddenCount } = globalBoard(queue(entries));
    expect(rows).toHaveLength(GLOBAL_BOARD_LIMIT);
    expect(hiddenCount).toBe(15);
  });

  test("the nearly-full buckets are the ones that survive the cap", () => {
    const entries: [string, BucketKey[], number][] = [];
    for (let i = 0; i < 70; i += 1) {
      entries.push([`a${i}`, [bucketKey(`Relic ${i}`, "radiant")], 1000 + i]);
    }
    // One bucket climbs to three; it must be row zero despite being newest.
    entries.push(["x", [bucketKey("Relic 69", "radiant")], 5000]);
    entries.push(["y", [bucketKey("Relic 69", "radiant")], 5001]);

    const { rows } = globalBoard(queue(entries));
    expect(rows[0]).toEqual({ bucketKey: bucketKey("Relic 69", "radiant"), count: 3 });
  });

  test("hiddenCount is zero when everything fits", () => {
    expect(globalBoard(queue([["a", [AXI], 1000]])).hiddenCount).toBe(0);
  });
});

describe("the personal board", () => {
  test("is only the buckets you are in", () => {
    const buckets = queue([
      ["a", [AXI, MESO], 1000],
      ["b", [LITH], 1001],
      ["c", [AXI], 1002],
    ]);
    expect(personalBoard(buckets, "a").map((r) => r.bucketKey).sort()).toEqual([AXI, MESO].sort());
  });

  test("carries the full count, not just your own presence", () => {
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [AXI], 1001],
      ["c", [AXI], 1002],
    ]);
    expect(personalBoard(buckets, "a")).toEqual([{ bucketKey: AXI, count: 3 }]);
  });

  test("is never below 1/4, because queueing creates the bucket with you in it", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    expect(personalBoard(buckets, "a")).toEqual([{ bucketKey: AXI, count: 1 }]);
  });

  test("is empty for someone not queued", () => {
    expect(personalBoard(queue([["a", [AXI], 1000]]), "stranger")).toEqual([]);
  });

  test("is not capped -- your own twenty are all yours", () => {
    const keys = Array.from({ length: 20 }, (_, i) => bucketKey(`R${i}`, "radiant"));
    expect(personalBoard(queue([["a", keys, 1000]]), "a")).toHaveLength(20);
  });
});

describe("the mode is a function of queue state", () => {
  test("unqueued and signed in is the global board", () => {
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [MESO], 1001],
    ]);
    const stream = new BoardStream("viewer");
    const snap = stream.snapshot(buckets, 5000);
    expect(snap.mode).toBe("global");
    expect(snap.rows).toHaveLength(2);
    expect(snap.you.buckets).toEqual([]);
  });

  test("queueing swaps the same surface to your own buckets", () => {
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [MESO], 1001],
    ]);
    const stream = new BoardStream("a");
    expect(stream.snapshot(buckets, 5000).mode).toBe("personal");
    expect(stream.snapshot(buckets, 5000).rows).toEqual([{ bucketKey: AXI, count: 1 }]);
  });

  test("leaving the queue swaps back to global", () => {
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [MESO], 1001],
    ]);
    const stream = new BoardStream("a");
    expect(stream.snapshot(buckets, 5000).mode).toBe("personal");

    planMatch(buckets, { accountId: "a", selection: [] }, 5100);
    expect(stream.snapshot(buckets, 5200).mode).toBe("global");
  });

  test("the mode follows queue state, not authentication", () => {
    // Two signed-in sockets, same instant, different modes -- because one is
    // queued and one is not.
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [MESO], 1001],
    ]);
    expect(new BoardStream("a").snapshot(buckets, 5000).mode).toBe("personal");
    expect(new BoardStream("onlooker").snapshot(buckets, 5000).mode).toBe("global");
  });

  test("nobody unqueued ever faces an empty screen while others are queued", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    const snap = new BoardStream("newcomer").snapshot(buckets, 5000);
    expect(snap.rows.length).toBeGreaterThan(0);
  });

  test("isQueued is what picks the mode", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    expect(isQueued(buckets, "a")).toBe(true);
    expect(isQueued(buckets, "b")).toBe(false);
  });
});

describe("snapshot.you", () => {
  test("is present in global mode too, so a reconnect knows which mode to render", () => {
    // Queue entries are account-keyed and survive a socket swap. Without this
    // field a refresh renders the global board while actually queued, and
    // re-sending queue.join to fix it would silently reset enqueuedAt.
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [MESO], 1001],
    ]);
    const snap = new BoardStream("a").snapshot(buckets, 5000);
    expect(snap.you.buckets).toEqual([{ bucketKey: AXI, count: 1 }]);
  });

  test("a fresh socket for a queued account lands in personal mode unprompted", () => {
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [AXI], 1001],
    ]);
    const secondDevice = new BoardStream("a");
    const snap = secondDevice.snapshot(buckets, 9000);
    expect(snap.mode).toBe("personal");
    expect(snap.you.buckets).toEqual([{ bucketKey: AXI, count: 2 }]);
  });

  test("is empty for an unqueued viewer rather than absent", () => {
    const snap = new BoardStream("viewer").snapshot(queue([["a", [AXI], 1000]]), 5000);
    expect(snap.you.buckets).toEqual([]);
  });
});

describe("deltas", () => {
  test("report a count that moved", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    const stream = new BoardStream("viewer");
    stream.snapshot(buckets, 5000);

    planMatch(buckets, { accountId: "b", selection: [AXI] }, 5100);
    expect(stream.delta(buckets).rows).toEqual([{ bucketKey: AXI, count: 2, inBoard: true }]);
  });

  test("mark a bucket that emptied as gone, not as zero", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    const stream = new BoardStream("viewer");
    stream.snapshot(buckets, 5000);

    planMatch(buckets, { accountId: "a", selection: [] }, 5100);
    expect(stream.delta(buckets).rows).toEqual([{ bucketKey: AXI, count: 0, inBoard: false }]);
  });

  test("mark a bucket that fell out of the top 60 as gone", () => {
    // It was never touched -- another bucket growing pushed it off. A delta
    // driven by touched keys alone would leave a stale row on screen forever.
    const entries: [string, BucketKey[], number][] = [];
    for (let i = 0; i < 60; i += 1) {
      entries.push([`a${i}`, [bucketKey(`Relic ${i}`, "radiant")], 1000 + i]);
    }
    const buckets = queue(entries);
    const stream = new BoardStream("viewer");
    const before = stream.snapshot(buckets, 5000);
    expect(before.rows).toHaveLength(60);
    expect(before.hiddenCount).toBe(0);

    const newcomer = bucketKey("Relic 999", "radiant");
    planMatch(buckets, { accountId: "x", selection: [newcomer] }, 5100);
    planMatch(buckets, { accountId: "y", selection: [newcomer] }, 5101);

    const delta = stream.delta(buckets);
    const dropped = delta.rows.filter((r) => !r.inBoard);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.bucketKey).toBe(bucketKey("Relic 59", "radiant"));
    expect(delta.hiddenCount).toBe(1);
  });

  test("carry hiddenCount on the global stream", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    const stream = new BoardStream("viewer", 1);
    stream.snapshot(buckets, 5000);
    planMatch(buckets, { accountId: "b", selection: [MESO] }, 5100);
    expect(stream.delta(buckets).hiddenCount).toBe(1);
  });

  test("carry no hiddenCount on the personal stream", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    const stream = new BoardStream("a");
    stream.snapshot(buckets, 5000);
    const delta = stream.delta(buckets);
    expect(delta.mode).toBe("personal");
    expect(delta.hiddenCount).toBeUndefined();
  });

  test("are always inBoard on the personal stream while you hold the bucket", () => {
    const buckets = queue([["a", [AXI, MESO], 1000]]);
    const stream = new BoardStream("a");
    stream.snapshot(buckets, 5000);
    planMatch(buckets, { accountId: "b", selection: [AXI] }, 5100);
    expect(stream.delta(buckets).rows.every((r) => r.inBoard)).toBe(true);
  });

  test("a bucket you left is removed from your personal stream", () => {
    const buckets = queue([["a", [AXI, MESO], 1000]]);
    const stream = new BoardStream("a");
    stream.snapshot(buckets, 5000);

    planMatch(buckets, { accountId: "a", selection: [AXI] }, 5100);
    const gone = stream.delta(buckets).rows.filter((r) => !r.inBoard);
    expect(gone).toEqual([{ bucketKey: MESO, count: 0, inBoard: false }]);
  });

  test("a stream that has sent nothing yet still reports correctly", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    const stream = new BoardStream("viewer");
    expect(stream.delta(buckets).rows).toEqual([{ bucketKey: AXI, count: 1, inBoard: true }]);
  });
});

describe("an instant match skips personal mode entirely", () => {
  test("a join that completes a bucket leaves the joiner unqueued", () => {
    // match.found fires in the same pass and the user routes straight to the
    // lobby, so the personal board is never seen.
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [AXI], 1001],
      ["c", [AXI], 1002],
    ]);
    const stream = new BoardStream("d");
    const r = planMatch(buckets, { accountId: "d", selection: [AXI] }, 1003);
    expect(r.ok && r.plan.readyCheck).toBeTruthy();

    const snap = stream.snapshot(buckets, 1003);
    expect(snap.mode).toBe("global");
    expect(snap.you.buckets).toEqual([]);
  });
});

describe("the anonymous cache", () => {
  test("serves one projection for the whole window", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    const cache = new BoardCache();
    const first = cache.get(buckets, 5000);

    planMatch(buckets, { accountId: "b", selection: [AXI] }, 5100);
    expect(cache.get(buckets, 5000 + BOARD_CACHE_MS - 1)).toBe(first);
    expect(first.rows).toEqual([{ bucketKey: AXI, count: 1 }]);
  });

  test("recomputes once the window passes", () => {
    const buckets = queue([["a", [AXI], 1000]]);
    const cache = new BoardCache();
    cache.get(buckets, 5000);
    planMatch(buckets, { accountId: "b", selection: [AXI] }, 5100);

    expect(cache.get(buckets, 5000 + BOARD_CACHE_MS).rows).toEqual([{ bucketKey: AXI, count: 2 }]);
  });

  test("is ten seconds", () => {
    expect(BOARD_CACHE_MS).toBe(10_000);
  });

  test("carries its age so the row can say how stale it is", () => {
    const cache = new BoardCache();
    const board = cache.get(queue([["a", [AXI], 1000]]), 5000);
    expect(BoardCache.ageSeconds(board, 5000)).toBe(0);
    expect(BoardCache.ageSeconds(board, 12_000)).toBe(7);
  });

  test("has no `you` field, because an anonymous viewer cannot queue", () => {
    const board = new BoardCache().get(queue([["a", [AXI], 1000]]), 5000);
    expect(board).not.toHaveProperty("you");
  });

  test("shows anonymous and signed-in viewers the same rows", () => {
    // Same content, different transport. The cache is not a lesser board.
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [MESO], 1001],
    ]);
    const anon = new BoardCache().get(buckets, 5000);
    const live = new BoardStream("viewer").snapshot(buckets, 5000);
    expect(anon.rows).toEqual(live.rows);
    expect(anon.hiddenCount).toBe(live.hiddenCount!);
  });
});

describe("never seed fake presence", () => {
  test("an empty queue produces an empty board, not a placeholder", () => {
    const buckets: Buckets = new Map();
    expect(globalBoard(buckets)).toEqual({ rows: [], hiddenCount: 0 });
    expect(new BoardCache().get(buckets, 5000).rows).toEqual([]);
    expect(new BoardStream("viewer").snapshot(buckets, 5000).rows).toEqual([]);
  });

  test("every count is the real bucket length", () => {
    const buckets = queue([
      ["a", [AXI], 1000],
      ["b", [AXI], 1001],
    ]);
    for (const row of globalBoard(buckets).rows) {
      expect(row.count).toBe(buckets.get(row.bucketKey)!.length);
    }
  });
});
