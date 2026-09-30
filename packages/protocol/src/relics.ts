/**
 * The relic list, vendored from WFCD at build time by `scripts/vendor-relics.ts`
 * and checked in — a relic list that moves between deploys is a bucket key that
 * moves between deploys.
 *
 * WFCD has no refinement-independent relic, so `RelicId` is their uniqueName
 * minus the shared prefix and the refinement suffix.
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
  /** Out of the drop tables — the relics recruiting chat cannot fill. */
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
 * WFCD ids that print the same name as a canonical relic — `Lith G12` today.
 *
 * A player only knows the printed name, so two people each holding "Lith G12"
 * must land in the same bucket. Without this they queue side by side forever.
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

/** The server's `knownRelic`. */
export function isKnownRelic(relicId: RelicId): boolean {
  return BY_ID.has(canonicalRelicId(relicId));
}

/** Falls back to the id verbatim. Ugly beats a fabricated name. */
export function relicName(relicId: RelicId): string {
  return findRelic(relicId)?.name ?? relicId;
}

export function relicTier(relicId: RelicId): RelicTier | null {
  return findRelic(relicId)?.tier ?? null;
}

/**
 * Prefix matches rank above substring ones: typing "axi a1" should give Axi A1,
 * not Axi A10 through A19. Ties break on name so the list never reshuffles.
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

/** Resolves aliases, so two spellings of one relic share a bucket. */
export function relicBucketKey(relicId: RelicId, refinement: Refinement): BucketKey {
  return `${canonicalRelicId(relicId)}:${refinement}`;
}

export { REFINEMENTS };
