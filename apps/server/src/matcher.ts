/**
 * The matcher. This is the load-bearing piece and it is deliberately dull.
 *
 * INVARIANT: every function here is SYNCHRONOUS and contains zero `await`s.
 * Nothing external is in scope — no clock, no socket, no database. Time is a
 * parameter. That is what makes the ordering tests exact instead of
 * timing-dependent, and it is what stops a stray database call opening a gap in
 * the middle of an eviction. `matcher.test.ts` asserts the return is not a
 * Promise; if you find yourself wanting `await` in this file, the call belongs
 * in the caller.
 *
 *   planMatch(buckets, request, now) -> PlanResult     a join
 *   planRestore(buckets, placements) -> Plan           putting evictions back
 *
 * Both may fire. Restoring is a join-shaped operation: entries going back into
 * a bucket can complete it, so it has to be able to produce a ready check too.
 */

import {
  MAX_PAIRS_PER_ACCOUNT,
  SQUAD_SIZE,
  type AccountId,
  type Bucket,
  type BucketKey,
  type Buckets,
  type Entry,
  type ErrorCode,
} from "@radshare/protocol";

export type Delta = { bucketKey: BucketKey; count: number };

/** Where an entry was, so it can go back to exactly the same place. */
export type EvictedPlacement = { bucketKey: BucketKey; entry: Entry };

/**
 * A bucket reaching four does NOT create a lobby. It opens a ready check, and
 * the lobby exists only once all four confirm.
 */
export type ReadyCheck = {
  bucketKey: BucketKey;
  /** Exactly SQUAD_SIZE, FIFO order (oldest first). */
  members: Entry[];
  /** The longest waiter. Deterministic, already tracked, rewards the wait. */
  hostAccountId: AccountId;
};

export type Plan = {
  /** Every bucket whose count changed. `count: 0` means the bucket was deleted. */
  deltas: Delta[];
  readyCheck: ReadyCheck | null;
  /**
   * What the fire removed, if anything. The caller keeps this so it can put
   * people back when the ready gate fails or a lobby insert fails.
   */
  evicted: EvictedPlacement[];
};

export type PlanResult = { ok: true; plan: Plan } | { ok: false; error: ErrorCode };

export type JoinRequest = {
  accountId: AccountId;
  /**
   * The account's FULL current selection, not a diff. `queue.join` is an
   * idempotent set operation: the server diffs against what is held, keeps
   * `enqueuedAt` for unchanged buckets, and timestamps only genuinely new ones.
   * That makes toggling a relic useless as a way to game the tiebreak.
   */
  selection: BucketKey[];
};

// ---------------------------------------------------------------------------
// bucket primitives
// ---------------------------------------------------------------------------

/** Ascending by enqueuedAt; accountId breaks ties so ordering is total. */
function orderOf(a: Entry, b: Entry): number {
  return a.enqueuedAt - b.enqueuedAt || (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0);
}

/** Creates the bucket if absent. Keeps it sorted. */
function insert(buckets: Buckets, key: BucketKey, entry: Entry): void {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = [];
    buckets.set(key, bucket);
  }
  if (bucket.some((e) => e.accountId === entry.accountId)) {
    throw new Error(`matcher: ${entry.accountId} already in ${key} — one slot per account per bucket`);
  }
  let i = bucket.length;
  while (i > 0 && orderOf(bucket[i - 1]!, entry) > 0) i--;
  bucket.splice(i, 0, entry);
}

/** Deletes the bucket when it empties — `0/4` is not a state this system has. */
function remove(buckets: Buckets, key: BucketKey, accountId: AccountId): Entry | null {
  const bucket = buckets.get(key);
  if (!bucket) return null;
  const i = bucket.findIndex((e) => e.accountId === accountId);
  if (i === -1) return null;
  const [entry] = bucket.splice(i, 1);
  if (bucket.length === 0) buckets.delete(key);
  return entry ?? null;
}

function keysHolding(buckets: Buckets, accountId: AccountId): BucketKey[] {
  const out: BucketKey[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.some((e) => e.accountId === accountId)) out.push(key);
  }
  return out;
}

function deltasFor(buckets: Buckets, touched: Iterable<BucketKey>): Delta[] {
  const seen = new Set<BucketKey>();
  const out: Delta[] = [];
  for (const key of touched) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bucketKey: key, count: buckets.get(key)?.length ?? 0 });
  }
  return out.sort((a, b) => (a.bucketKey < b.bucketKey ? -1 : a.bucketKey > b.bucketKey ? 1 : 0));
}

// ---------------------------------------------------------------------------
// firing
// ---------------------------------------------------------------------------

/**
 * At most ONE bucket may fire per pass, even when several reach four, because
 * the entries that completed them are shared and can only join one squad.
 *
 * Tiebreak is the oldest-waiting bucket, measured by the `enqueuedAt` of its
 * oldest current entry, then bucket key lexicographically. Deterministic and
 * testable — never an accident of Map iteration order.
 */
function pickFiringBucket(buckets: Buckets, candidates: Iterable<BucketKey>): BucketKey | null {
  let best: BucketKey | null = null;
  let bestAge = Number.POSITIVE_INFINITY;
  for (const key of candidates) {
    const bucket = buckets.get(key);
    if (!bucket || bucket.length < SQUAD_SIZE) continue;
    const age = bucket[0]!.enqueuedAt;
    if (age < bestAge || (age === bestAge && best !== null && key < best)) {
      best = key;
      bestAge = age;
    }
  }
  return best;
}

/**
 * Fires `key`, evicting the chosen four from EVERY bucket they occupy — not just
 * this one. Someone about to be in a ready check must not also be counted as
 * waiting elsewhere.
 */
function fire(buckets: Buckets, key: BucketKey, touched: Set<BucketKey>): { readyCheck: ReadyCheck; evicted: EvictedPlacement[] } {
  const bucket = buckets.get(key)!;
  const members = bucket.slice(0, SQUAD_SIZE); // FIFO, already sorted
  const evicted: EvictedPlacement[] = [];

  for (const member of members) {
    for (const held of keysHolding(buckets, member.accountId)) {
      const entry = remove(buckets, held, member.accountId);
      if (entry) {
        evicted.push({ bucketKey: held, entry });
        touched.add(held);
      }
    }
  }

  return {
    readyCheck: { bucketKey: key, members, hostAccountId: members[0]!.accountId },
    evicted,
  };
}

// ---------------------------------------------------------------------------
// the two entry points
// ---------------------------------------------------------------------------

export function planMatch(buckets: Buckets, request: JoinRequest, now: number): PlanResult {
  const desired = new Set(request.selection);

  // The cap is on (relic, refinement) PAIRS, and the whole message is rejected
  // rather than partially applied — a partial join would silently give the user
  // a selection they did not ask for.
  if (desired.size > MAX_PAIRS_PER_ACCOUNT) {
    return { ok: false, error: "QUEUE_CAP_EXCEEDED" };
  }

  const held = new Set(keysHolding(buckets, request.accountId));
  const touched = new Set<BucketKey>();

  for (const key of held) {
    if (!desired.has(key)) {
      remove(buckets, key, request.accountId);
      touched.add(key);
    }
  }

  const added: BucketKey[] = [];
  for (const key of desired) {
    if (held.has(key)) continue; // unchanged buckets keep their original enqueuedAt
    insert(buckets, key, { accountId: request.accountId, enqueuedAt: now });
    touched.add(key);
    added.push(key);
  }

  // Only a bucket this pass ADDED to can have reached four.
  const firing = pickFiringBucket(buckets, added);
  let readyCheck: ReadyCheck | null = null;
  let evicted: EvictedPlacement[] = [];
  if (firing) {
    const result = fire(buckets, firing, touched);
    readyCheck = result.readyCheck;
    evicted = result.evicted;
  }

  return { ok: true, plan: { deltas: deltasFor(buckets, touched), readyCheck, evicted } };
}

/**
 * Puts evicted entries back with their ORIGINAL `enqueuedAt`, so a failed ready
 * gate or a failed lobby insert costs nobody their position.
 *
 * This is a function rather than an `undo()` closure on the plan deliberately.
 * A closure would capture the world as it was at fire time and run up to a
 * minute later, by which point other people have joined those buckets. Restoring
 * blindly against a changed map can push a bucket past four. Re-evaluating here
 * means a restore that completes a bucket fires it, which is correct: those are
 * four real people waiting on the same relic.
 */
export function planRestore(buckets: Buckets, placements: EvictedPlacement[]): Plan {
  const touched = new Set<BucketKey>();
  const restored: BucketKey[] = [];

  for (const { bucketKey, entry } of placements) {
    const bucket = buckets.get(bucketKey);
    if (bucket?.some((e) => e.accountId === entry.accountId)) continue; // already back
    insert(buckets, bucketKey, entry);
    touched.add(bucketKey);
    restored.push(bucketKey);
  }

  const firing = pickFiringBucket(buckets, restored);
  let readyCheck: ReadyCheck | null = null;
  let evicted: EvictedPlacement[] = [];
  if (firing) {
    const result = fire(buckets, firing, touched);
    readyCheck = result.readyCheck;
    evicted = result.evicted;
  }

  return { deltas: deltasFor(buckets, touched), readyCheck, evicted };
}

/** Removes an account from every bucket. Used on disconnect and on a failed ready gate. */
export function planLeave(buckets: Buckets, accountId: AccountId): Plan {
  const touched = new Set<BucketKey>();
  for (const key of keysHolding(buckets, accountId)) {
    remove(buckets, key, accountId);
    touched.add(key);
  }
  return { deltas: deltasFor(buckets, touched), readyCheck: null, evicted: [] };
}
