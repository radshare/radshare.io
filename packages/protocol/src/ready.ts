/**
 * The ready gate: between a bucket reaching four and a lobby existing.
 *
 * A bucket hitting four opens a ready check, not a lobby — so a no-show cannot
 * cost three other people a dead room. This is the product's only enforcement;
 * it replaced the rating system, which needed volume before it meant anything.
 */

import type { AccountId, BucketKey } from "./queue.ts";

/** Confirmations must all land inside this window or the match is void. */
export const READY_WINDOW_MS = 60_000;

/** An opaque handle for one ready check. Carries no relic or lobby information. */
export type GateId = string;

/** `confirmed` is the only per-member fact on the wire, and it dies with the gate. */
export type ReadyMemberView = {
  accountId: AccountId;
  confirmed: boolean;
};

/** server -> client, on queue pop. */
export type ReadyCheckMessage = {
  type: "ready.check";
  gateId: GateId;
  bucketKey: BucketKey;
  members: ReadyMemberView[];
  /** Absolute, so slow delivery shortens the countdown rather than the gate. */
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

/** Both audiences are told. Silently emptying someone's queue would be the worst version. */
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
