/**
 * The ready gate store. Same discipline as the matcher: synchronous,
 * time-injected, opaque account ids. `expire(now)` is driven by the caller's
 * timer, so no test sleeps through 60 seconds.
 *
 * Decides who comes back. Touches no buckets and writes no rows — it returns
 * placements and the caller feeds them to `planRestore`.
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
  /** Exactly SQUAD_SIZE, oldest first. */
  members: Entry[];
  /** Chosen at fire time, so it cannot shift mid-gate. */
  hostAccountId: AccountId;
  confirmed: Set<AccountId>;
  openedAt: number;
  deadlineAt: number;
  /**
   * Across EVERY bucket they held, not just the one that popped — a fire evicts
   * from all of them, so this is the only record of the others.
   */
  evicted: EvictedPlacement[];
};

export type ConfirmOutcome =
  /** Unknown or already ended. Confirming late is not an error. */
  | { kind: "unknown" }
  /** Should be unreachable. A no-op rather than a throw. */
  | { kind: "not-a-member" }
  | { kind: "pending"; gate: Gate; members: ReadyMemberView[] }
  /** All four in. The caller creates the lobby; the gate is already closed. */
  | { kind: "complete"; gate: Gate };

/** Both audiences are named, so no caller can tell only one of them. */
export type GateFailure = {
  gate: Gate;
  /** Feed to `planRestore`. */
  restore: EvictedPlacement[];
  confirmers: AccountId[];
  /** Out of the queue entirely — their placements are dropped. */
  nonConfirmers: AccountId[];
  reason: (accountId: AccountId) => ReadyFailedReason;
};

let counter = 0;
const defaultNewId = (): GateId => `g${(counter += 1).toString(36)}`;

export class ReadyGates {
  #gates = new Map<GateId, Gate>();
  /**
   * An account is in at most one gate, since a fire evicts it everywhere.
   * `open` asserts that rather than trusting it.
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

  /** Idempotent: a second press is not a second vote. */
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
   * Non-confirmers leave the queue entirely — every bucket, not just the one
   * that popped. Someone who missed a countdown carrying a gong, a title flip
   * and a notification is not at their machine, and leaving them queued sends
   * the next three people into the same dead end. Their selection is retained,
   * so returning is one click.
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
   * Fails the gate NOW rather than burning the countdown: they cannot confirm,
   * so the other three are only waiting to be told. They count as absent even
   * if they had pressed the button — a lobby they are not connected to is the
   * dead room the gate exists to prevent.
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
