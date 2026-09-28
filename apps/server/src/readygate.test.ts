import { describe, expect, test } from "bun:test";
import { READY_WINDOW_MS, bucketKey, type BucketKey, type Buckets } from "@radshare/protocol";
import { planMatch, planRestore, type EvictedPlacement, type ReadyCheck } from "./matcher.ts";
import { ReadyGates } from "./readygate.ts";

const AXI = bucketKey("Axi A2", "radiant");
const MEO = bucketKey("Meso B4", "radiant");

/** Deterministic ids so an assertion can name a gate. */
function gates() {
  let n = 0;
  return new ReadyGates(() => `g${(n += 1)}`);
}

/** Fill a bucket to four and hand back the fired plan. */
function fill(
  selections: BucketKey[][],
  startAt = 1000,
): { buckets: Buckets; check: ReadyCheck; evicted: EvictedPlacement[] } {
  const buckets: Buckets = new Map();
  let last;
  for (const [i, selection] of selections.entries()) {
    const r = planMatch(buckets, { accountId: `p${i + 1}`, selection }, startAt + i);
    if (!r.ok) throw new Error(r.error);
    last = r.plan;
  }
  if (!last?.readyCheck) throw new Error("expected a fire");
  return { buckets, check: last.readyCheck, evicted: last.evicted };
}

const four = [[AXI], [AXI], [AXI], [AXI]];

/** p1 holds a second bucket, so a restore has to reach beyond the one that popped. */
function fillWithSpectator(): { buckets: Buckets; check: ReadyCheck; evicted: EvictedPlacement[] } {
  const buckets: Buckets = new Map();
  const first = planMatch(buckets, { accountId: "p1", selection: [AXI, MEO] }, 1000);
  if (!first.ok) throw new Error(first.error);
  let last;
  for (const [i, id] of ["p2", "p3", "p4"].entries()) {
    const r = planMatch(buckets, { accountId: id, selection: [AXI] }, 1001 + i);
    if (!r.ok) throw new Error(r.error);
    last = r.plan;
  }
  if (!last?.readyCheck) throw new Error("expected a fire");
  return { buckets, check: last.readyCheck, evicted: last.evicted };
}

describe("opening a gate", () => {
  test("a bucket reaching four opens a gate rather than a lobby", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);

    expect(gate.members.map((m) => m.accountId)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(gate.confirmed.size).toBe(0);
    expect(g.size).toBe(1);
  });

  test("the deadline is exactly the 60s window from open", () => {
    const { check, evicted } = fill(four);
    const gate = gates().open(check, evicted, 5000);
    expect(gate.deadlineAt - gate.openedAt).toBe(READY_WINDOW_MS);
    expect(READY_WINDOW_MS).toBe(60_000);
  });

  test("the host is the longest waiter, fixed at open", () => {
    const { check, evicted } = fill(four);
    const gate = gates().open(check, evicted, 5000);
    expect(gate.hostAccountId).toBe("p1");
  });

  test("an account cannot be in two gates at once", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    g.open(check, evicted, 5000);
    expect(() => g.open(check, evicted, 5000)).toThrow(/already in gate/);
  });

  test("the gate carries placements from every bucket the members held", () => {
    // p1 also queued for Meso. The fire evicted it from BOTH, so the gate is
    // the only record of the Meso entry until someone restores it.
    const { check, evicted } = fillWithSpectator();
    const gate = gates().open(check, evicted, 5000);

    const p1 = gate.evicted.filter((p) => p.entry.accountId === "p1").map((p) => p.bucketKey);
    expect(p1.sort()).toEqual([AXI, MEO].sort());
  });
});

describe("confirming", () => {
  test("three confirmations leave the gate pending", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);

    for (const id of ["p1", "p2", "p3"]) {
      expect(g.confirm(gate.gateId, id, 6000).kind).toBe("pending");
    }
    expect(g.size).toBe(1);
  });

  test("the pending view shows who is ticked and who is not", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);
    const out = g.confirm(gate.gateId, "p2", 6000);

    expect(out.kind).toBe("pending");
    if (out.kind !== "pending") return;
    expect(out.members).toEqual([
      { accountId: "p1", confirmed: false },
      { accountId: "p2", confirmed: true },
      { accountId: "p3", confirmed: false },
      { accountId: "p4", confirmed: false },
    ]);
  });

  test("the fourth confirmation completes and closes the gate", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);

    let out;
    for (const id of ["p1", "p2", "p3", "p4"]) out = g.confirm(gate.gateId, id, 6000);
    expect(out!.kind).toBe("complete");
    expect(g.size).toBe(0);
    expect(g.gateFor("p1")).toBeUndefined();
  });

  test("pressing the button twice is not a second vote", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);

    g.confirm(gate.gateId, "p1", 6000);
    g.confirm(gate.gateId, "p1", 6001);
    g.confirm(gate.gateId, "p1", 6002);
    expect(gate.confirmed.size).toBe(1);
    expect(g.confirm(gate.gateId, "p2", 6003).kind).toBe("pending");
  });

  test("a confirmation on the deadline is too late", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);
    expect(g.confirm(gate.gateId, "p1", gate.deadlineAt).kind).toBe("unknown");
    expect(g.confirm(gate.gateId, "p1", gate.deadlineAt - 1).kind).toBe("pending");
  });

  test("confirming an unknown or already-ended gate is a no-op, not an error", () => {
    expect(gates().confirm("nope", "p1", 6000)).toEqual({ kind: "unknown" });
  });

  test("a stranger confirming is rejected without affecting the gate", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);
    expect(g.confirm(gate.gateId, "outsider", 6000).kind).toBe("not-a-member");
    expect(gate.confirmed.size).toBe(0);
  });
});

describe("expiry", () => {
  test("a gate expires only once its window has fully elapsed", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);

    expect(g.expire(gate.deadlineAt - 1)).toEqual([]);
    expect(g.expire(gate.deadlineAt)).toHaveLength(1);
    expect(g.size).toBe(0);
  });

  test("non-confirmers come out of the queue entirely; confirmers come back", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);
    g.confirm(gate.gateId, "p1", 6000);
    g.confirm(gate.gateId, "p3", 6000);

    const [failure] = g.expire(gate.deadlineAt);
    expect(failure!.confirmers).toEqual(["p1", "p3"]);
    expect(failure!.nonConfirmers).toEqual(["p2", "p4"]);
    expect(failure!.restore.map((p) => p.entry.accountId).sort()).toEqual(["p1", "p3"]);
  });

  test("each audience gets its own reason and nobody is left unaddressed", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);
    g.confirm(gate.gateId, "p1", 6000);

    const [failure] = g.expire(gate.deadlineAt);
    expect(failure!.reason("p1")).toBe("someone-did-not-confirm");
    expect(failure!.reason("p2")).toBe("you-did-not-confirm");

    const addressed = [...failure!.confirmers, ...failure!.nonConfirmers].sort();
    expect(addressed).toEqual(["p1", "p2", "p3", "p4"]);
  });

  test("a gate nobody answered fails with everyone removed", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);

    const [failure] = g.expire(gate.deadlineAt);
    expect(failure!.confirmers).toEqual([]);
    expect(failure!.nonConfirmers).toHaveLength(4);
    expect(failure!.restore).toEqual([]);
  });

  test("expiry sweeps every overdue gate in one pass", () => {
    const g = gates();
    const a = fill(four);
    g.open(a.check, a.evicted, 5000);

    // A separate bucket with separate people, so the one-gate-per-account
    // invariant is not what is under test here.
    const b = fill([[MEO], [MEO], [MEO], [MEO]], 2000);
    for (const m of b.check.members) m.accountId = `q${m.accountId}`;
    for (const p of b.evicted) p.entry.accountId = `q${p.entry.accountId}`;
    b.check.hostAccountId = `q${b.check.hostAccountId}`;
    g.open(b.check, b.evicted, 5000);

    expect(g.size).toBe(2);
    expect(g.expire(5000 + READY_WINDOW_MS)).toHaveLength(2);
  });
});

describe("a member vanishing mid-gate", () => {
  test("the gate fails immediately rather than burning the countdown", () => {
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);
    g.confirm(gate.gateId, "p1", 6000);

    const failure = g.abandon("p3", 6500);
    expect(failure).not.toBeNull();
    expect(failure!.confirmers).toEqual(["p1"]);
    expect(g.size).toBe(0);
  });

  test("a member who confirmed and then vanished still counts as absent", () => {
    // A lobby they are not connected to is exactly the dead room the gate
    // exists to prevent, so the confirmation does not survive the disconnect.
    const { check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);
    for (const id of ["p1", "p2", "p3"]) g.confirm(gate.gateId, id, 6000);

    const failure = g.abandon("p2", 6500);
    expect(failure!.nonConfirmers).toEqual(["p2", "p4"]);
    expect(failure!.restore.map((p) => p.entry.accountId)).toEqual(["p1", "p3"]);
  });

  test("a disconnect from someone with no gate is nothing", () => {
    expect(gates().abandon("nobody", 6000)).toBeNull();
  });
});

describe("failure feeds back into the matcher", () => {
  test("confirmers land back in their buckets with their original enqueuedAt", () => {
    const { buckets, check, evicted } = fill(four);
    expect(buckets.get(AXI)).toBeUndefined(); // the fire emptied it

    const g = gates();
    const gate = g.open(check, evicted, 5000);
    g.confirm(gate.gateId, "p1", 6000);
    g.confirm(gate.gateId, "p2", 6000);

    const [failure] = g.expire(gate.deadlineAt);
    planRestore(buckets, failure!.restore);

    const back = buckets.get(AXI)!;
    expect(back.map((e) => e.accountId)).toEqual(["p1", "p2"]);
    expect(back.map((e) => e.enqueuedAt)).toEqual([1000, 1001]);
  });

  test("a confirmer keeps every other bucket they held, not just the one that popped", () => {
    const { buckets, check, evicted } = fillWithSpectator();
    const g = gates();
    const gate = g.open(check, evicted, 5000);
    g.confirm(gate.gateId, "p1", 6000);

    const [failure] = g.expire(gate.deadlineAt);
    planRestore(buckets, failure!.restore);

    expect(buckets.get(AXI)!.map((e) => e.accountId)).toEqual(["p1"]);
    expect(buckets.get(MEO)!.map((e) => e.accountId)).toEqual(["p1"]);
  });

  test("a non-confirmer is in no bucket at all afterwards", () => {
    const { buckets, check, evicted } = fillWithSpectator();
    const g = gates();
    const gate = g.open(check, evicted, 5000);

    const [failure] = g.expire(gate.deadlineAt);
    planRestore(buckets, failure!.restore);

    for (const bucket of buckets.values()) {
      expect(bucket.some((e) => e.accountId === "p1")).toBe(false);
    }
  });

  test("restoring three confirmers cannot re-fire the same match", () => {
    // Only a fourth person joining should fire again. A restore that fired on
    // three would mean the gate handed back more than it took.
    const { buckets, check, evicted } = fill(four);
    const g = gates();
    const gate = g.open(check, evicted, 5000);
    for (const id of ["p1", "p2", "p3"]) g.confirm(gate.gateId, id, 6000);

    const [failure] = g.expire(gate.deadlineAt);
    const plan = planRestore(buckets, failure!.restore);
    expect(plan.readyCheck).toBeNull();
    expect(buckets.get(AXI)).toHaveLength(3);
  });
});
