/**
 * Turning a bucket key into something a person reads.
 *
 * Relic display names come from the vendored WFCD build-time JSON. Until that
 * file is generated the id is shown verbatim — ugly, but never wrong, and
 * never a placeholder standing in for a real relic.
 */

import { parseBucketKey, type BucketKey, type Refinement } from "@radshare/protocol";

export type RelicLabel = {
  relicId: string;
  /** e.g. "Axi G9". Falls back to the id when the name is unknown. */
  name: string;
  refinement: Refinement;
};

export type RelicNames = Record<string, string>;

export function labelFor(key: BucketKey, names: RelicNames = {}): RelicLabel {
  const { relicId, refinement } = parseBucketKey(key);
  return { relicId, name: names[relicId] ?? relicId, refinement };
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
