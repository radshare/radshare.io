/**
 * Queue and bucket vocabulary, shared across the WebSocket boundary.
 *
 * A BUCKET is pre-match. A LOBBY is post-match. They never share a word.
 */

export type AccountId = string;

/**
 * A relic, independent of refinement: WFCD's `uniqueName` minus the shared
 * prefix and the refinement suffix.
 *
 * WFCD has no refinement-independent relic — every entry of theirs is one
 * (relic, refinement) pair. Carrying their id verbatim would produce
 * `T4VoidProjectionEBronze:radiant`, i.e. "Intact, radiant". See `relics.ts`.
 */
export type RelicId = string;

export const REFINEMENTS = ["intact", "exceptional", "flawless", "radiant"] as const;
export type Refinement = (typeof REFINEMENTS)[number];

/** `${relicId}:${refinement}`. Platform is deliberately NOT part of the key. */
export type BucketKey = string;

export function bucketKey(relicId: RelicId, refinement: Refinement): BucketKey {
  return `${relicId}:${refinement}`;
}

export function parseBucketKey(key: BucketKey): { relicId: RelicId; refinement: Refinement } {
  const i = key.lastIndexOf(":");
  const relicId = key.slice(0, i);
  const refinement = key.slice(i + 1) as Refinement;
  return { relicId, refinement };
}

/** How many people a squad needs. Not configurable — it is a property of the game. */
export const SQUAD_SIZE = 4;

/**
 * Cap on (relic, refinement) PAIRS, not relics. At launch scale one account's
 * 40 single-person buckets would be a visible fraction of a 60-row board.
 */
export const MAX_PAIRS_PER_ACCOUNT = 20;

/**
 * No connection reference: an account may hold several sockets, so connections
 * live in a separate registry and eviction waits for the last close.
 */
export type Entry = {
  accountId: AccountId;
  enqueuedAt: number;
};

/**
 * Ascending by `enqueuedAt` — FIFO is a contract, not an accident of insertion
 * order. A bucket exists only while non-empty, so `0/4` is unreachable.
 */
export type Bucket = Entry[];

export type Buckets = Map<BucketKey, Bucket>;
