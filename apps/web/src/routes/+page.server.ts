/**
 * Server-rendered so the board is populated before JavaScript runs — that is
 * the only way it works as the marketing surface, and it is why the adapter is
 * adapter-node rather than adapter-static.
 *
 * The board data comes from the server's cached projection (`BoardCache`) once
 * the Hono host is wired. Until then this returns nothing and the page renders
 * its empty state, which is accurate rather than a placeholder.
 */
export const prerender = false;

export function load() {
  return { rows: [], hiddenCount: 0 };
}
