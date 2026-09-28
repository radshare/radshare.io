/**
 * The ready gate store.
 *
 * Same discipline as the matcher: SYNCHRONOUS, time-injected, and holding
 * opaque account ids rather than sockets. `expire(now)` is called from a timer
 * in the caller, never from a clock in here, so the 60-second window is exact
 * in tests instead of something a test has to sleep through.
 *
 * What this file decides is who comes back and who does not. What it does NOT
 * do is touch buckets, write a row or send a frame — it returns the placements
 * to restore and the caller feeds them to `planRestore`. That keeps the
 * eviction/restore pair in one place (the matcher) and keeps the gate testable
 * without a database.
 */

import {
  READY_WINDOW_MS,
  type AccountId,
  type BucketKey,
  type Entry,
  type GateId,
  type ReadyFailedReason,
  type ReadyMemberView,
} from "@radshare/protocol";
import type { EvictedPlacement, ReadyCheck } from "./matcher.ts";

export type Gate = {
  gateId: GateId;
  bucketKey: BucketKey;
  /** Exactly SQUAD_SIZE, FIFO order. */
  members: Entry[];
  /** The longest waiter, chosen at fire time so it cannot shift mid-gate. */
  hostAccountId: AccountId;
  confirmed: Set<AccountId>;
  openedAt: number;
  deadlineAt: number;
  /**
   * Where these four came from, across EVERY bucket they held — not just the
   * one that popped. A fire evicts an account from all of its buckets, so this
   * is the only record of a confirmer's position in the others.
   */
  evicted: EvictedPlacement[];
};

export type ConfirmOutcome =
  /** Unknown gate, or one that already ended. Confirming late is not an error. */
  | { kind: "unknown" }
  /** Not your gate. Should be unreachable; treated as a no-op rather than a throw. */
  | { kind: "not-a-member" }
  /** Recorded. Still waiting on others. `members` is the view to broadcast. */
  | { kind: "pending"; gate: Gate; members: ReadyMemberView[] }
  /** All four in. The caller creates the lobby; the gate is already closed. */
  | { kind: "complete"; gate: Gate };

/**
 * A gate that ended without a lobby. Both audiences are named explicitly so no
 * caller can accidentally tell only one of them.
 */
export type GateFailure = {
  gate: Gate;
  /** Back to their buckets, original `enqueuedAt`. Feed to `planRestore`. */
  restore: EvictedPlacement[];
  confirmers: AccountId[];
  /** Out of the queue entirely. Their placements are deliberately dropped. */
  nonConfirmers: AccountId[];
  reason: (accountId: AccountId) => ReadyFailedReason;
};

let counter = 0;
const defaultNewId = (): GateId => `g${(counter += 1).toString(36)}`;

export class ReadyGates {
  #gates = new Map<GateId, Gate>();
  /**
   * An account is in at most one gate: a fire evicts it from every bucket, so
   * it cannot be sitting in a second bucket waiting to pop. This index is what
   * lets a disconnect find the gate in O(1), and `open` asserts the invariant
   * rather than trusting it.
   */
  #byAccount = new Map<AccountId, GateId>();

  constructor(private readonly newId: () => GateId = defaultNewId) {}

  open(check: ReadyCheck, evicted: EvictedPlacement[], now: number): Gate {
    for (const m of check.members) {
      const existing = this.#byAccount.get(m.accountId);
      if (existing !== undefined) {
        throw new Error(
          `${m.accountId} is already in gate ${existing}; a fire should have evicted it from every bucket`,
        );
      }
    }

    const gate: Gate = {
      gateId: this.newId(),
      bucketKey: check.bucketKey,
      members: check.members,
      hostAccountId: check.hostAccountId,
      confirmed: new Set(),
      openedAt: now,
      deadlineAt: now + READY_WINDOW_MS,
      evicted,
    };

    this.#gates.set(gate.gateId, gate);
    for (const m of check.members) this.#byAccount.set(m.accountId, gate.gateId);
    return gate;
  }

  /** Idempotent. Pressing the button twice is not an error and not a second vote. */
  confirm(gateId: GateId, accountId: AccountId, now: number): ConfirmOutcome {
    const gate = this.#gates.get(gateId);
    if (!gate) return { kind: "unknown" };
    if (now >= gate.deadlineAt) return { kind: "unknown" };
    if (!gate.members.some((m) => m.accountId === accountId)) return { kind: "not-a-member" };

    gate.confirmed.add(accountId);
    if (gate.confirmed.size < gate.members.length) {
      return { kind: "pending", gate, members: viewOf(gate) };
    }

    this.#close(gate);
    return { kind: "complete", gate };
  }

  /**
   * Every gate whose deadline has passed, closed and reported.
   *
   * Non-confirmers are removed from the queue entirely — every bucket, not just
   * the one that popped. Someone who missed a 60-second countdown carrying a
   * gong, a title flip and a browser notification is not at their machine, and
   * leaving them queued means the next three people hit the same dead end. The
   * cost lands on the absent user as one click, because their selection is
   * retained; the lenient alternative charges strangers who did nothing wrong.
   */
  expire(now: number): GateFailure[] {
    const failures: GateFailure[] = [];
    for (const gate of [...this.#gates.values()]) {
      if (now < gate.deadlineAt) continue;
      this.#close(gate);
      failures.push(failureOf(gate));
    }
    return failures;
  }

  /**
   * A member's last socket closed mid-gate. The gate fails NOW rather than
   * burning the remaining countdown: they cannot confirm, so the other three
   * are only waiting to be told. The departed member counts as a non-confirmer
   * even if they had already pressed the button — a lobby they are not
   * connected to is the dead room the gate exists to prevent.
   */
  abandon(accountId: AccountId, _now: number): GateFailure | null {
    const gateId = this.#byAccount.get(accountId);
    if (gateId === undefined) return null;
    const gate = this.#gates.get(gateId);
    if (!gate) return null;

    this.#close(gate);
    gate.confirmed.delete(accountId);
    return failureOf(gate);
  }

  get(gateId: GateId): Gate | undefined {
    return this.#gates.get(gateId);
  }

  gateFor(accountId: AccountId): Gate | undefined {
    const gateId = this.#byAccount.get(accountId);
    return gateId === undefined ? undefined : this.#gates.get(gateId);
  }

  get size(): number {
    return this.#gates.size;
  }

  #close(gate: Gate): void {
    this.#gates.delete(gate.gateId);
    for (const m of gate.members) {
      if (this.#byAccount.get(m.accountId) === gate.gateId) this.#byAccount.delete(m.accountId);
    }
  }
}

function viewOf(gate: Gate): ReadyMemberView[] {
  return gate.members.map((m) => ({
    accountId: m.accountId,
    confirmed: gate.confirmed.has(m.accountId),
  }));
}

function failureOf(gate: Gate): GateFailure {
  const confirmers = gate.members.filter((m) => gate.confirmed.has(m.accountId)).map((m) => m.accountId);
  const nonConfirmers = gate.members.filter((m) => !gate.confirmed.has(m.accountId)).map((m) => m.accountId);
  const back = new Set(confirmers);

  return {
    gate,
    restore: gate.evicted.filter((p) => back.has(p.entry.accountId)),
    confirmers,
    nonConfirmers,
    reason: (accountId) =>
      back.has(accountId) ? "someone-did-not-confirm" : "you-did-not-confirm",
  };
}
