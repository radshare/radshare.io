/**
 * Bucket keys into something a person reads. Names come from the vendored WFCD
 * list, which both ends share, so no two surfaces can disagree.
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
  /** Falls back to the id. */
  name: string;
  tier: RelicTier | null;
  refinement: Refinement;
};

/** An unknown id renders verbatim. Ugly beats a fabricated name. */
export function labelFor(key: BucketKey): RelicLabel {
  const { relicId, refinement } = parseBucketKey(key);
  return { relicId, name: relicName(relicId), tier: relicTier(relicId), refinement };
}

/** The wire always carries lowercase. */
export function refinementLabel(refinement: Refinement): string {
  return refinement.charAt(0).toUpperCase() + refinement.slice(1);
}

/**
 * A sentence rather than a bare `1/4`. The danger zone is a rare relic sitting
 * at one person: a number reads as "nothing is happening", a sentence reads as
 * "you are early".
 */
export function waitingCopy(count: number, name: string): string | null {
  if (count === 1) return `You're first in line for ${name}.`;
  if (count === 2) return `One other Tenno is holding ${name}.`;
  if (count === 3) return `Two others are holding ${name}. One more and you're in.`;
  return null;
}
