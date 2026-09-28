/**
 * The HTTP surface.
 *
 * One origin serves the client and terminates the WebSocket, so there is no
 * CORS story and no second hostname to keep in sync.
 *
 * `GET /api/board` is the ANONYMOUS half of the board and the only route that
 * matters before sign-in. A hundred anonymous readers cost one cached
 * projection rather than a hundred live connections, which is what lets one
 * pinned box survive its own launch post, and the same payload is rendered
 * into first paint so a visitor from Reddit sees a populated board before
 * JavaScript runs.
 */

import { Hono } from "hono";
import type { Hub } from "./hub.ts";
import { BoardCache } from "./board.ts";
import { BOARD_CACHE_MS, PLATFORMS, type Platform } from "@radshare/protocol";
import { clientIp, ConnectionCap, MAX_SOCKETS_PER_IP } from "./limits.ts";
import { IgnRequiredError, upsertAccount } from "./lobby.ts";

/** Injected per request by the server entry; see `index.ts`. */
export type AppBindings = {
  /** The raw socket peer, used only as a no-proxy development fallback. */
  peer: string | null;
  /** Bun's upgrade hook. Returns false when the handshake cannot complete. */
  upgrade: (data: { accountId: string; connectionId: string; ip: string | null }) => boolean;
};

export type AppDeps = {
  hub: Hub;
  cap: ConnectionCap;
  authenticate: (req: Request) => Promise<string | null>;
  now?: () => number;
};

export function createApp(deps: AppDeps) {
  const now = deps.now ?? Date.now;
  const app = new Hono<{ Bindings: AppBindings }>();

  app.get("/api/health", (c) => c.json({ ok: true }));

  /**
   * The cached board. `Cache-Control` matches the in-process TTL so a CDN or a
   * browser reuses exactly what the server would have reused, and `updatedAgo`
   * carries the staleness explicitly — a ten-second board is honest as long as
   * it says how old it is.
   */
  app.get("/api/board", (c) => {
    const board = deps.hub.cachedBoard();
    const at = now();
    c.header("Cache-Control", `public, max-age=${Math.floor(BOARD_CACHE_MS / 1000)}`);
    return c.json({
      rows: board.rows,
      hiddenCount: board.hiddenCount,
      updatedAgo: BoardCache.ageSeconds(board, at),
      // Distinct accounts holding at least one entry — not sockets and not
      // anonymous browsers, both of which would inflate it. Labelled "queued",
      // never "online", and NEVER seeded.
      playersQueued: deps.hub.playersQueued(),
    });
  });

  /**
   * Who am I, and have I finished signing up?
   *
   * `hasAccount` false means signed in with Clerk but no in-game name yet, so
   * the client shows the first-run screen. There is no third state: an account
   * row exists only once a name has been set.
   */
  app.get("/api/me", async (c) => {
    const accountId = await deps.authenticate(c.req.raw);
    if (!accountId) return c.json({ error: "AUTH_FAILED" }, 401);
    return c.json({ accountId, hasAccount: deps.hub.hasAccount(accountId) });
  });

  /**
   * Creates or updates the account. The in-game name is REQUIRED and this is
   * the only path that writes one — a Clerk sign-in by itself creates nothing.
   *
   * Nothing here is verified against the game. DE exposes no player API, so the
   * name is self-declared exactly like mastery rank; required and verified are
   * different claims and only the first is made.
   */
  app.post("/api/account", async (c) => {
    const accountId = await deps.authenticate(c.req.raw);
    if (!accountId) return c.json({ error: "AUTH_FAILED" }, 401);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "IGN_REQUIRED" }, 400);
    }
    const input = (body ?? {}) as Record<string, unknown>;
    if (typeof input.ign !== "string") return c.json({ error: "IGN_REQUIRED" }, 400);

    const platform = PLATFORMS.includes(input.platform as Platform)
      ? (input.platform as Platform)
      : null;
    const masteryRank =
      typeof input.masteryRank === "number" && Number.isInteger(input.masteryRank)
        ? input.masteryRank
        : null;

    try {
      upsertAccount(deps.hub.db, { accountId, ign: input.ign, platform, masteryRank }, now());
    } catch (e) {
      if (e instanceof IgnRequiredError) return c.json({ error: e.code }, 400);
      return c.json({ error: "IGN_REQUIRED" }, 400);
    }
    return c.json({ accountId, hasAccount: true });
  });

  /**
   * The upgrade handshake.
   *
   * Both checks happen HERE rather than after the socket opens, so a connection
   * flood never allocates socket state. The IP comes from `X-Forwarded-For`,
   * because behind Caddy the socket peer is a pooled upstream connection shared
   * between visitors — keying on it would count the whole userbase as one
   * person and lock everyone out at the sixth connection.
   */
  app.get("/ws", async (c) => {
    const accountId = await deps.authenticate(c.req.raw);
    if (!accountId) return c.json({ error: "AUTH_FAILED" }, 401);

    const ip = clientIp(c.req.raw.headers, c.env.peer);
    const connectionId = crypto.randomUUID();
    if (!deps.cap.admit(ip, connectionId)) {
      return c.json({ error: "RATE_LIMITED", max: MAX_SOCKETS_PER_IP }, 429);
    }

    const upgraded = c.env.upgrade({ accountId, connectionId, ip });
    if (upgraded) return new Response(null, { status: 101 });

    deps.cap.release(ip, connectionId);
    return c.json({ error: "upgrade failed" }, 400);
  });

  return app;
}
