/**
 * Queue and bucket vocabulary, shared across the WebSocket boundary.
 *
 * A BUCKET is pre-match. A LOBBY is post-match. They never share a word.
 */

export type AccountId = string;

/**
 * A relic, independent of refinement.
 *
 * Derived from WFCD's `uniqueName` by stripping the common
 * `/Lotus/Types/Game/Projections/` prefix and the refinement suffix — because
 * WFCD HAS NO refinement-independent relic. Every entry in their file is one
 * (relic, refinement) pair, with the refinement baked into both the display
 * name ("Axi A1 Radiant") and the id (…EPlatinum). Carrying their id verbatim
 * would produce keys like `T4VoidProjectionEBronze:radiant`, which reads
 * "Intact, radiant".
 *
 * See `relics.ts`. The vendored file records the prefix and the suffix map, so
 * the original uniqueName is always recoverable.
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
 * Cap on the PRODUCT, not the relic list: 10 relics x 4 refinements would be 40
 * buckets, and at launch scale one account's 40 single-person buckets would be a
 * visible fraction of a 60-row board.
 */
export const MAX_PAIRS_PER_ACCOUNT = 20;

/**
 * A bucket entry holds no connection reference at all. Connections live in a
 * separate registry, because an account may hold several sockets at once and is
 * evicted only when its last one closes.
 */
export type Entry = {
  accountId: AccountId;
  enqueuedAt: number;
};

/**
 * Ordered ascending by `enqueuedAt`. FIFO selection is an explicit contract, not
 * an accident of insertion order.
 *
 * A bucket exists only while it holds at least one entry: created by the first
 * joiner, deleted on the last removal. `0/4` is therefore not a state this
 * system can be in, and the board never renders it.
 */
export type Bucket = Entry[];

export type Buckets = Map<BucketKey, Bucket>;
