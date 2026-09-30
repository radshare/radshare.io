import type { PageServerLoad } from "./$types";

/**
 * Server-rendered so the board is in FIRST PAINT — it can only be the marketing
 * surface if it is there before the page boots, which is why the adapter is
 * adapter-node.
 *
 * Reads the same cached endpoint an anonymous poller would, so the two paths
 * cannot disagree.
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
    // Empty, never invented.
    return { rows: [], hiddenCount: 0, updatedAgo: null, playersQueued: 0 };
  }
};
