import { describe, expect, test } from "bun:test";
import {
  canonicalRelicId,
  findRelic,
  findRelicByName,
  isKnownRelic,
  RELICS,
  RELIC_TIERS,
  relicBucketKey,
  relicName,
  relicTier,
  searchRelics,
} from "./relics.ts";
import { parseBucketKey, REFINEMENTS } from "./queue.ts";

describe("the vendored list", () => {
  test("covers every tier a player can hold", () => {
    const tiers = new Set(RELICS.map((r) => r.tier));
    for (const tier of ["lith", "meso", "neo", "axi"] as const) expect(tiers).toContain(tier);
  });

  test("has the shape the composer needs", () => {
    for (const relic of RELICS.slice(0, 50)) {
      expect(relic.id.length).toBeGreaterThan(0);
      expect(relic.name.length).toBeGreaterThan(0);
      expect(RELIC_TIERS).toContain(relic.tier);
      expect(typeof relic.vaulted).toBe("boolean");
    }
  });

  test("ids are unique", () => {
    expect(new Set(RELICS.map((r) => r.id)).size).toBe(RELICS.length);
  });

  test("display names are unique, so a player can always pick unambiguously", () => {
    // The player only knows the printed name. Two rows reading "Lith G12"
    // would be an unanswerable question.
    expect(new Set(RELICS.map((r) => r.name)).size).toBe(RELICS.length);
  });

  test("no id carries a refinement suffix", () => {
    // WFCD bakes refinement into the id. Ours must not, or a bucket key would
    // read "Intact, radiant".
    for (const relic of RELICS) {
      expect(relic.id).not.toMatch(/(Bronze|Silver|Gold|Platinum)$/);
    }
  });

  test("no name carries a refinement word", () => {
    for (const relic of RELICS) {
      expect(relic.name).not.toMatch(/(Intact|Exceptional|Flawless|Radiant)$/);
    }
  });

  test("the generic placeholder entries were dropped", () => {
    // "Axi Relic", "Void Relic" and friends are not relics anyone holds.
    expect(RELICS.some((r) => r.name.endsWith(" Relic"))).toBe(false);
  });

  test("most of the list is vaulted, which is the whole wedge", () => {
    const vaulted = RELICS.filter((r) => r.vaulted).length;
    expect(vaulted).toBeGreaterThan(RELICS.length / 2);
  });
});

describe("duplicate display names are merged", () => {
  test("Lith G12 resolves to exactly one relic", () => {
    const matches = RELICS.filter((r) => r.name === "Lith G12");
    expect(matches).toHaveLength(1);
  });

  test("the alias resolves to the canonical id", () => {
    // Two people each holding "Lith G12" must land in the SAME bucket.
    // Without this they sit queued forever, side by side, never matching.
    const canonical = findRelicByName("Lith G12")!;
    const alias =
      canonical.id === "T1VoidProjectionSevagothPrimeD"
        ? "T1VoidProjectionSevagothPrimeE"
        : "T1VoidProjectionSevagothPrimeD";

    expect(canonicalRelicId(alias)).toBe(canonical.id);
    expect(findRelic(alias)!.id).toBe(canonical.id);
    expect(relicBucketKey(alias, "radiant")).toBe(relicBucketKey(canonical.id, "radiant"));
  });

  test("a canonical id passes through unchanged", () => {
    const relic = RELICS[0]!;
    expect(canonicalRelicId(relic.id)).toBe(relic.id);
  });
});

describe("lookup", () => {
  test("finds a relic by id", () => {
    const relic = RELICS[0]!;
    expect(findRelic(relic.id)!.name).toBe(relic.name);
  });

  test("finds a relic by name, ignoring case and padding", () => {
    expect(findRelicByName("  axi a1  ")!.name).toBe("Axi A1");
  });

  test("an unknown id is unknown rather than invented", () => {
    expect(findRelic("NotARelic")).toBeUndefined();
    expect(isKnownRelic("NotARelic")).toBe(false);
    expect(relicTier("NotARelic")).toBeNull();
  });

  test("an unknown id renders verbatim, never as a placeholder", () => {
    // Ugly beats wrong: a fabricated name on a board whose only claim is
    // honesty would be worse than showing the raw id.
    expect(relicName("NotARelic")).toBe("NotARelic");
  });

  test("every vendored id is known", () => {
    for (const relic of RELICS) expect(isKnownRelic(relic.id)).toBe(true);
  });
});

describe("search", () => {
  test("a prefix match ranks above a substring match", () => {
    // Someone typing "axi a1" wants Axi A1, not Axi A10 through A19.
    const results = searchRelics("axi a1");
    expect(results[0]!.name).toBe("Axi A1");
  });

  test("it is case-insensitive", () => {
    expect(searchRelics("AXI A1")[0]!.name).toBe("Axi A1");
  });

  test("a tier name finds that tier", () => {
    const results = searchRelics("meso", 10);
    expect(results.every((r) => r.tier === "meso")).toBe(true);
  });

  test("an empty query returns the head of the list, not everything", () => {
    expect(searchRelics("", 12)).toHaveLength(12);
  });

  test("a query matching nothing returns nothing", () => {
    // The composer names the query back rather than showing a stale list.
    expect(searchRelics("axi z9")).toEqual([]);
  });

  test("results are stable between identical queries", () => {
    expect(searchRelics("lith g").map((r) => r.id)).toEqual(
      searchRelics("lith g").map((r) => r.id),
    );
  });

  test("the limit is respected", () => {
    expect(searchRelics("axi", 5)).toHaveLength(5);
  });
});

describe("bucket keys", () => {
  test("round-trip through parse", () => {
    const relic = findRelicByName("Axi A1")!;
    for (const refinement of REFINEMENTS) {
      const key = relicBucketKey(relic.id, refinement);
      const parsed = parseBucketKey(key);
      expect(parsed.relicId).toBe(relic.id);
      expect(parsed.refinement).toBe(refinement);
      expect(relicName(parsed.relicId)).toBe("Axi A1");
    }
  });

  test("every relic produces a parseable key", () => {
    for (const relic of RELICS) {
      const parsed = parseBucketKey(relicBucketKey(relic.id, "radiant"));
      expect(parsed.relicId).toBe(relic.id);
      expect(parsed.refinement).toBe("radiant");
    }
  });
});
