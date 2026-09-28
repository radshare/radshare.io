import type { PageServerLoad } from "./$types";

/**
 * Server-rendered so the cached board is in FIRST PAINT.
 *
 * A visitor from Reddit sees a populated board before JavaScript runs, and the
 * link preview is not blank. The board can only be the marketing surface if it
 * is there before the page boots — which is why the adapter is adapter-node
 * and not adapter-static.
 *
 * This reads the same cached endpoint an anonymous poller would, so the two
 * paths cannot disagree.
 */
export const prerender = false;

export const load: PageServerLoad = async ({ fetch }) => {
  try {
    const res = await fetch("/api/board");
    if (!res.ok) return { rows: [], hiddenCount: 0, updatedAgo: null, playersQueued: 0 };
    return (await res.json()) as {
      rows: { bucketKey: string; count: number }[];
      hiddenCount: number;
      updatedAgo: number;
      playersQueued: number;
    };
  } catch {
    // A board that cannot be fetched renders empty and says so. It never
    // renders invented rows.
    return { rows: [], hiddenCount: 0, updatedAgo: null, playersQueued: 0 };
  }
};
