/**
 * Turning a bucket key into something a person reads.
 *
 * Names and tiers come from the vendored WFCD list in `@radshare/protocol`,
 * which both ends share — so a board row, a ready check and a lobby header
 * cannot disagree about what a relic is called.
 */

import {
  parseBucketKey,
  relicName,
  relicTier,
  type BucketKey,
  type Refinement,
  type RelicTier,
} from "@radshare/protocol";

export type RelicLabel = {
  relicId: string;
  /** e.g. "Axi G9". Falls back to the id when the relic is unknown. */
  name: string;
  tier: RelicTier | null;
  refinement: Refinement;
};

/**
 * Names come from the vendored WFCD list, which both ends share — so a board
 * row and a lobby header cannot disagree about what a relic is called.
 *
 * An unknown id renders verbatim rather than as a placeholder. Ugly beats
 * wrong on a board whose only claim is that its contents are real.
 */
export function labelFor(key: BucketKey): RelicLabel {
  const { relicId, refinement } = parseBucketKey(key);
  return { relicId, name: relicName(relicId), tier: relicTier(relicId), refinement };
}

/** Title case for display. The wire always carries the lowercase value. */
export function refinementLabel(refinement: Refinement): string {
  return refinement.charAt(0).toUpperCase() + refinement.slice(1);
}

/**
 * "You're first in line for Axi G9" rather than a bare `1/4`.
 *
 * The danger zone of the whole product is a rare relic sitting at one person
 * for an unknown length of time. A number alone at that moment reads as
 * "nothing is happening"; a sentence reads as "you are early".
 */
export function waitingCopy(count: number, name: string): string | null {
  if (count === 1) return `You're first in line for ${name}.`;
  if (count === 2) return `One other Tenno is holding ${name}.`;
  if (count === 3) return `Two others are holding ${name}. One more and you're in.`;
  return null;
}
