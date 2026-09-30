/**
 * The relic list, vendored from WFCD at build time.
 *
 * `relics.generated.json` is produced by `scripts/vendor-relics.ts` and checked
 * in. A build that reaches out to GitHub fails when GitHub does, and a relic
 * list that moves between deploys is a bucket key that moves between deploys.
 *
 * **WFCD has no refinement-independent relic.** Every entry in their file is
 * one (relic, refinement) pair, with the refinement in both the display name
 * and the uniqueName. Our `RelicId` is the base — their uniqueName with the
 * common prefix and the refinement suffix removed — and the refinement is
 * ours. That is what lets a bucket key mean "Axi A1, radiant" rather than
 * "Axi A1 Intact, radiant".
 */

import data from "./relics.generated.json" with { type: "json" };
import { REFINEMENTS, type BucketKey, type Refinement, type RelicId } from "./queue.ts";

export const RELIC_TIERS = ["lith", "meso", "neo", "axi", "requiem", "vanguard"] as const;
export type RelicTier = (typeof RELIC_TIERS)[number];

export type Relic = {
  id: RelicId;
  /** What the player sees in their inventory, e.g. "Axi A1". */
  name: string;
  tier: RelicTier;
  /** Out of the drop tables. The whole reason this product exists. */
  vaulted: boolean;
};

export const RELICS: readonly Relic[] = data.relics.map((r) => ({
  id: r.id,
  name: r.name,
  tier: r.tier as RelicTier,
  vaulted: r.vaulted,
}));

export const RELIC_SOURCE = data.source;
export const RELIC_DATA_GENERATED_AT = data.generatedAt;

const BY_ID = new Map<RelicId, Relic>(RELICS.map((r) => [r.id, r]));
const BY_NAME = new Map<string, Relic>(RELICS.map((r) => [r.name.toLowerCase(), r]));

/**
 * Alternate WFCD ids that print the same name as a canonical relic.
 *
 * Exactly one relic needs this today (`Lith G12`), and it matters more than
 * its size suggests: a player only ever knows the printed name, so two people
 * each holding "Lith G12" must land in the SAME bucket. Without the alias they
 * would sit queued forever, side by side, never matching.
 */
const ALIAS_TO_CANONICAL = new Map<RelicId, RelicId>();
for (const r of data.relics) {
  for (const alias of (r as { aliases?: string[] }).aliases ?? []) {
    ALIAS_TO_CANONICAL.set(alias, r.id);
  }
}

/** Resolves an alias to the canonical id. Returns the input when already canonical. */
export function canonicalRelicId(relicId: RelicId): RelicId {
  return ALIAS_TO_CANONICAL.get(relicId) ?? relicId;
}

export function findRelic(relicId: RelicId): Relic | undefined {
  return BY_ID.get(canonicalRelicId(relicId));
}

export function findRelicByName(name: string): Relic | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

/** True when the id names a relic that exists. The server's `knownRelic`. */
export function isKnownRelic(relicId: RelicId): boolean {
  return BY_ID.has(canonicalRelicId(relicId));
}

/** The display name, or the id verbatim when unknown — never a placeholder. */
export function relicName(relicId: RelicId): string {
  return findRelic(relicId)?.name ?? relicId;
}

export function relicTier(relicId: RelicId): RelicTier | null {
  return findRelic(relicId)?.tier ?? null;
}

/**
 * Free-text search for the composer.
 *
 * Prefix matches rank above substring ones, because someone typing "axi a1"
 * wants Axi A1 first and not Axi A10 through A19. Ties break on name so the
 * list never reshuffles between keystrokes that match the same set.
 */
export function searchRelics(query: string, limit = 40): Relic[] {
  const q = query.trim().toLowerCase();
  if (q === "") return RELICS.slice(0, limit);

  const prefix: Relic[] = [];
  const contains: Relic[] = [];
  for (const relic of RELICS) {
    const name = relic.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(relic);
    else if (name.includes(q)) contains.push(relic);
  }

  const byName = (a: Relic, b: Relic) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return [...prefix.sort(byName), ...contains.sort(byName)].slice(0, limit);
}

/** Builds a bucket key from a relic and a refinement, resolving aliases. */
export function relicBucketKey(relicId: RelicId, refinement: Refinement): BucketKey {
  return `${canonicalRelicId(relicId)}:${refinement}`;
}

export { REFINEMENTS };
