/**
 * The ready gate: the window between a bucket reaching four and a lobby
 * existing.
 *
 * A bucket hitting four does NOT create a lobby. It opens a ready check. The
 * lobby exists only once all four have confirmed, which is why a no-show can no
 * longer cost three other people a dead room — there is no room to be dead.
 *
 * This is the product's ONLY enforcement mechanism. It replaced the rating
 * system outright: a gate acts in 60 seconds, applies itself, needs no
 * threshold, and works with four users as well as with forty thousand.
 */

import type { AccountId, BucketKey } from "./queue.ts";

/** Confirmations must all land inside this window or the match is void. */
export const READY_WINDOW_MS = 60_000;

/** An opaque handle for one ready check. Carries no relic or lobby information. */
export type GateId = string;

/**
 * What one member looks like to the other three while the countdown runs.
 * `confirmed` is the only per-member fact on the wire — there is no readiness
 * history, no score, and nothing here outlives the gate.
 */
export type ReadyMemberView = {
  accountId: AccountId;
  confirmed: boolean;
};

/** server -> client, on queue pop. The emotional peak of the product. */
export type ReadyCheckMessage = {
  type: "ready.check";
  gateId: GateId;
  bucketKey: BucketKey;
  members: ReadyMemberView[];
  /** Absolute epoch ms. Sent as a deadline rather than a duration so a slow
   *  delivery shortens the client's countdown instead of extending the gate. */
  deadlineAt: number;
};

/** server -> client, each time somebody confirms. */
export type ReadyStateMessage = {
  type: "ready.state";
  gateId: GateId;
  members: ReadyMemberView[];
};

/** client -> server. Idempotent: pressing twice is not an error. */
export type ReadyConfirmMessage = {
  type: "ready.confirm";
  gateId: GateId;
};

/**
 * Why a gate ended without a lobby. The two audiences are treated differently
 * and BOTH are told — silently emptying someone's queue would be the worst
 * version of this.
 */
export type ReadyFailedReason =
  /** You are out of the queue entirely, every bucket. */
  | "you-did-not-confirm"
  /** You are back in your buckets holding your original position. */
  | "someone-did-not-confirm";

export const READY_FAILED_COPY = {
  "you-did-not-confirm":
    "You didn't confirm in time, so you've been removed from the queue.",
  "someone-did-not-confirm":
    "Someone didn't confirm, so the match was cancelled. You're back in the queue, in the same place.",
} as const satisfies Record<ReadyFailedReason, string>;

export function readyFailedCopy(reason: ReadyFailedReason): string {
  return READY_FAILED_COPY[reason];
}

/** server -> client, when the gate ends without a lobby. */
export type ReadyFailedMessage = {
  type: "ready.failed";
  gateId: GateId;
  reason: ReadyFailedReason;
};
