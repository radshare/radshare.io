import { describe, expect, test } from "bun:test";
import { MAX_PAIRS_PER_ACCOUNT, SQUAD_SIZE, type Buckets } from "@radshare/protocol";
import { planLeave, planMatch, planRestore, type EvictedPlacement } from "./matcher.ts";

const AXI = "Axi G9:radiant";
const MESO = "Meso D6:radiant";
const NEO = "Neo V11:radiant";

function join(buckets: Buckets, accountId: string, selection: string[], now: number) {
  const result = planMatch(buckets, { accountId, selection }, now);
  if (!result.ok) throw new Error(`unexpected refusal: ${result.error}`);
  return result.plan;
}

function counts(buckets: Buckets): Record<string, number> {
  return Object.fromEntries([...buckets].map(([k, v]) => [k, v.length]));
}

// ---------------------------------------------------------------------------

describe("the zero-await invariant", () => {
  test("planMatch returns synchronously, not a Promise", () => {
    const result = planMatch(new Map(), { accountId: "a", selection: [AXI] }, 1000);
    expect(result).not.toBeInstanceOf(Promise);
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  test("planRestore and planLeave return synchronously too", () => {
    expect(planRestore(new Map(), [])).not.toBeInstanceOf(Promise);
    expect(planLeave(new Map(), "a")).not.toBeInstanceOf(Promise);
  });
});

describe("bucket lifecycle", () => {
  test("a bucket is created by its first joiner", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI], 1000);
    expect(b.get(AXI)).toHaveLength(1);
  });

  test("a bucket is deleted when its last member leaves — 0/4 is unreachable", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI], 1000);
    join(b, "a", [], 2000);
    expect(b.has(AXI)).toBe(false);
    for (const bucket of b.values()) expect(bucket.length).toBeGreaterThan(0);
  });

  test("no bucket is ever observable at 0/4 or 4/4", () => {
    const b: Buckets = new Map();
    const seen: number[] = [];
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      const plan = join(b, id, [AXI], 1000 + i);
      for (const bucket of b.values()) seen.push(bucket.length);
      for (const d of plan.deltas) seen.push(d.count);
    }
    expect(seen.every((n) => n !== SQUAD_SIZE)).toBe(true);
    for (const bucket of b.values()) expect(bucket.length).not.toBe(0);
  });
});

describe("firing", () => {
  test("the fourth joiner fires a ready check, not a lobby", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI], 1000);
    join(b, "b", [AXI], 2000);
    join(b, "c", [AXI], 3000);
    const plan = join(b, "d", [AXI], 4000);

    expect(plan.readyCheck).not.toBeNull();
    expect(plan.readyCheck!.bucketKey).toBe(AXI);
    expect(plan.readyCheck!.members).toHaveLength(SQUAD_SIZE);
    expect(b.has(AXI)).toBe(false); // fired and emptied, so deleted
  });

  test("host is the longest waiter", () => {
    const b: Buckets = new Map();
    join(b, "late", [AXI], 9000);
    join(b, "earliest", [AXI], 1000);
    join(b, "mid", [AXI], 5000);
    const plan = join(b, "last", [AXI], 9999);
    expect(plan.readyCheck!.hostAccountId).toBe("earliest");
  });

  test("members are FIFO by enqueuedAt, and a fifth waits its turn", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI], 1000);
    join(b, "b", [AXI], 2000);
    join(b, "c", [AXI], 3000);
    // 'e' is already queued elsewhere and joins AXI before 'd'
    join(b, "e", [MESO], 500);
    const plan = join(b, "d", [AXI], 4000);

    expect(plan.readyCheck!.members.map((m) => m.accountId)).toEqual(["a", "b", "c", "d"]);
    expect(b.get(MESO)).toHaveLength(1); // 'e' untouched
  });

  test("evicts the four from EVERY bucket they held, not just the one that fired", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI, MESO, NEO], 1000);
    join(b, "b", [AXI, MESO], 2000);
    join(b, "c", [AXI], 3000);
    const plan = join(b, "d", [AXI], 4000);

    expect(plan.readyCheck).not.toBeNull();
    expect(counts(b)).toEqual({}); // every bucket they held is now empty and deleted
    expect(plan.evicted.map((e) => e.bucketKey).sort()).toEqual([AXI, AXI, AXI, AXI, MESO, MESO, NEO].sort());
  });
});

describe("one join filling two buckets", () => {
  test("exactly one fires; the other drops back and is not stranded at four", () => {
    const b: Buckets = new Map();
    // AXI has three waiting since t=1000..3000 (oldest entry 1000)
    join(b, "a", [AXI], 1000);
    join(b, "b", [AXI], 2000);
    join(b, "c", [AXI], 3000);
    // MESO has three waiting since t=5000..7000 (oldest entry 5000)
    join(b, "x", [MESO], 5000);
    join(b, "y", [MESO], 6000);
    join(b, "z", [MESO], 7000);

    // one account joins BOTH, completing both to four
    const plan = join(b, "shared", [AXI, MESO], 8000);

    expect(plan.readyCheck).not.toBeNull();
    // AXI's oldest entry (1000) beats MESO's (5000)
    expect(plan.readyCheck!.bucketKey).toBe(AXI);
    // MESO loses 'shared' and drops back to three — not four, not stranded
    expect(b.get(MESO)).toHaveLength(3);
    expect(b.has(AXI)).toBe(false);
  });

  test("tiebreak falls through to bucket key when ages are equal", () => {
    const b: Buckets = new Map();
    for (const id of ["a", "b", "c"]) join(b, id, [MESO], 1000);
    for (const id of ["p", "q", "r"]) join(b, id, [AXI], 1000);
    const plan = join(b, "shared", [MESO, AXI], 2000);
    // identical oldest-entry age, so lexicographic: "Axi G9:radiant" < "Meso D6:radiant"
    expect(plan.readyCheck!.bucketKey).toBe(AXI);
  });
});

describe("queue.join is an idempotent set operation", () => {
  test("unchanged buckets keep their original enqueuedAt", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI, MESO], 1000);
    join(b, "a", [AXI, NEO], 5000); // drops MESO, keeps AXI, adds NEO

    expect(b.get(AXI)![0]!.enqueuedAt).toBe(1000); // preserved
    expect(b.get(NEO)![0]!.enqueuedAt).toBe(5000); // newly timestamped
    expect(b.has(MESO)).toBe(false);
  });

  test("toggling a relic off and on does not refresh its position", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI], 1000);
    join(b, "a", [AXI], 9999); // re-sending the same selection
    expect(b.get(AXI)![0]!.enqueuedAt).toBe(1000);
  });

  test("the cap rejects the whole message rather than applying it partially", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI], 1000);
    const tooMany = Array.from({ length: MAX_PAIRS_PER_ACCOUNT + 1 }, (_, i) => `relic${i}:radiant`);
    const result = planMatch(b, { accountId: "a", selection: tooMany }, 2000);

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe("QUEUE_CAP_EXCEEDED");
    expect(counts(b)).toEqual({ [AXI]: 1 }); // untouched
  });

  test("duplicates in the selection do not count against the cap", () => {
    const b: Buckets = new Map();
    const dupes = Array.from({ length: MAX_PAIRS_PER_ACCOUNT }, () => AXI);
    const result = planMatch(b, { accountId: "a", selection: dupes }, 1000);
    expect(result.ok).toBe(true);
    expect(b.get(AXI)).toHaveLength(1);
  });
});

describe("restoring after a failed ready gate or lobby insert", () => {
  function firedSquad() {
    const b: Buckets = new Map();
    join(b, "a", [AXI, MESO], 1000);
    join(b, "b", [AXI], 2000);
    join(b, "c", [AXI], 3000);
    const plan = join(b, "d", [AXI], 4000);
    return { b, plan };
  }

  test("restoring all four re-fires the same squad — this is the lobby-insert retry", () => {
    const { b, plan } = firedSquad();
    const again = planRestore(b, plan.evicted);

    // Four people back in the same bucket completes it, so it fires again.
    // The retry is deliberate; the caller backs off after repeated MATCH_FAILED
    // rather than looping when writes are failing persistently.
    expect(again.readyCheck).not.toBeNull();
    expect(again.readyCheck!.members.map((m) => m.accountId)).toEqual(["a", "b", "c", "d"]);
    expect(again.readyCheck!.hostAccountId).toBe("a");
    // original positions survived the round trip
    expect(again.readyCheck!.members.map((m) => m.enqueuedAt)).toEqual([1000, 2000, 3000, 4000]);
  });

  test("restoring only the confirmers keeps their original enqueuedAt and does not fire", () => {
    const { b, plan } = firedSquad();
    const confirmed = new Set(["a", "b", "c"]);
    const toRestore = plan.evicted.filter((p: EvictedPlacement) => confirmed.has(p.entry.accountId));
    const restorePlan = planRestore(b, toRestore);

    expect(b.get(AXI)!.map((e) => [e.accountId, e.enqueuedAt])).toEqual([
      ["a", 1000],
      ["b", 2000],
      ["c", 3000],
    ]);
    expect(b.get(MESO)![0]!.enqueuedAt).toBe(1000); // 'a' restored to its other bucket too
    expect(restorePlan.readyCheck).toBeNull(); // only three, nothing fires
  });

  test("a restore that completes a bucket fires it — four real people are waiting", () => {
    const { b, plan } = firedSquad();
    // while the ready check was open, a newcomer joined AXI
    join(b, "newcomer", [AXI], 5000);
    // three confirmers come back, making four
    const confirmed = new Set(["a", "b", "c"]);
    const restorePlan = planRestore(b, plan.evicted.filter((p) => confirmed.has(p.entry.accountId)));

    expect(restorePlan.readyCheck).not.toBeNull();
    expect(restorePlan.readyCheck!.members.map((m) => m.accountId)).toEqual(["a", "b", "c", "newcomer"]);
    expect(restorePlan.readyCheck!.hostAccountId).toBe("a");
  });

  test("restoring is idempotent — a double restore does not duplicate anyone", () => {
    const { b, plan } = firedSquad();
    const toRestore = plan.evicted.filter((p) => p.entry.accountId === "a");
    planRestore(b, toRestore);
    planRestore(b, toRestore);
    expect(b.get(AXI)!.filter((e) => e.accountId === "a")).toHaveLength(1);
  });
});

describe("leaving", () => {
  test("planLeave clears every bucket the account held", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI, MESO, NEO], 1000);
    join(b, "keeper", [AXI], 2000);
    const plan = planLeave(b, "a");

    expect(counts(b)).toEqual({ [AXI]: 1 });
    expect(plan.deltas.find((d) => d.bucketKey === MESO)!.count).toBe(0);
  });
});

describe("deltas", () => {
  test("every changed bucket is reported, deleted ones as count 0", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI, MESO], 1000);
    const plan = join(b, "a", [NEO], 2000);
    const byKey = Object.fromEntries(plan.deltas.map((d) => [d.bucketKey, d.count]));
    expect(byKey).toEqual({ [AXI]: 0, [MESO]: 0, [NEO]: 1 });
  });

  test("a fire reports the bucket it drained and every bucket it touched", () => {
    const b: Buckets = new Map();
    join(b, "a", [AXI, MESO], 1000);
    join(b, "b", [AXI], 2000);
    join(b, "c", [AXI], 3000);
    join(b, "spectator", [MESO], 3500);
    const plan = join(b, "d", [AXI], 4000);

    const byKey = Object.fromEntries(plan.deltas.map((d) => [d.bucketKey, d.count]));
    expect(byKey[AXI]).toBe(0); // drained by the fire
    expect(byKey[MESO]).toBe(1); // 'a' left, spectator remains
  });
});
