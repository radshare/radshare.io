/**
 * The HTTP surface. One origin serves the client and terminates the socket, so
 * there is no CORS story and no second hostname.
 *
 * `GET /api/board` is the anonymous half: one cached projection for however
 * many readers, and the same payload server-rendered into first paint.
 */

import { Hono } from "hono";
import type { Hub } from "./hub.ts";
import { BoardCache } from "./board.ts";
import { BOARD_CACHE_MS, PLATFORMS, type Platform } from "@radshare/protocol";
import { clientIp, ConnectionCap, MAX_SOCKETS_PER_IP } from "./limits.ts";
import { IgnRequiredError, upsertAccount } from "./lobby.ts";
import { DEV_COOKIE, type AuthResult, type Authenticator } from "./auth.ts";

/** Injected per request by the server entry; see `index.ts`. */
export type AppBindings = {
  /** No-proxy development fallback only. */
  peer: string | null;
  /** False when the handshake cannot complete. */
  upgrade: (data: { accountId: string; connectionId: string; ip: string | null }) => boolean;
};

export type AppDeps = {
  hub: Hub;
  cap: ConnectionCap;
  authenticate: Authenticator;
  now?: () => number;
  /**
   * Registers `/api/dev-login`. Only ever true when the dev bypass is already
   * the active authenticator, so this route cannot exist in production even if
   * someone passes the flag by mistake.
   */
  devAuth?: boolean;
};

export function createApp(deps: AppDeps) {
  const now = deps.now ?? Date.now;
  const app = new Hono<{ Bindings: AppBindings }>();

  app.get("/api/health", (c) => c.json({ ok: true }));

  /**
   * `Cache-Control` matches the in-process TTL, so a CDN reuses exactly what
   * the server would have. A ten-second board is honest while it says its age.
   */
  app.get("/api/board", (c) => {
    const board = deps.hub.cachedBoard();
    const at = now();
    c.header("Cache-Control", `public, max-age=${Math.floor(BOARD_CACHE_MS / 1000)}`);
    return c.json({
      rows: board.rows,
      hiddenCount: board.hiddenCount,
      updatedAgo: BoardCache.ageSeconds(board, at),
      // Distinct ACCOUNTS, not sockets or browsers, both of which would
      // inflate it. Labelled "queued", never "online", and never seeded.
      playersQueued: deps.hub.playersQueued(),
    });
  });

  /**
   * Sign in as anybody. DEV ONLY.
   *
   * A browser cannot put a header on a WebSocket handshake, so the bypass needs
   * a cookie. Creates the account too, since a name is required before queueing
   * and there is no first-run screen yet.
   */
  if (deps.devAuth) {
    app.get("/api/dev-login", (c) => {
      const account = c.req.query("account") ?? "dev";
      const ign = c.req.query("ign") ?? account;
      try {
        upsertAccount(deps.hub.db, { accountId: account, ign, platform: "pc" }, now());
      } catch {
        return c.json({ error: "IGN_REQUIRED" }, 400);
      }
      c.header(
        "Set-Cookie",
        `${DEV_COOKIE}=${encodeURIComponent(account)}; Path=/; SameSite=Lax; Max-Age=86400`,
      );
      return c.redirect(c.req.query("next") ?? "/");
    });
  }

  /**
   * `hasAccount: false` means signed in but no in-game name yet, so the client
   * shows the first-run screen. There is no third state.
   */
  app.get("/api/me", async (c) => {
    const auth = await deps.authenticate(c.req.raw);
    if (auth.kind === "handshake") return handshake(auth);
    if (auth.kind === "signed-out") return c.json({ signedIn: false }, 200);
    return c.json({
      signedIn: true,
      accountId: auth.accountId,
      hasAccount: deps.hub.hasAccount(auth.accountId),
    });
  });

  /**
   * The only path that writes an in-game name — a Clerk sign-in by itself
   * creates nothing. Self-declared and unverified; DE exposes no player API.
   */
  app.post("/api/account", async (c) => {
    const auth = await deps.authenticate(c.req.raw);
    if (auth.kind === "handshake") return handshake(auth);
    if (auth.kind !== "signed-in") return c.json({ error: "AUTH_FAILED" }, 401);
    const accountId = auth.accountId;

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
   * Both checks run HERE, before any socket state is allocated. The IP comes
   * from `X-Forwarded-For` because Caddy's peer is a pooled connection shared
   * between visitors — keying on it locks out everyone at the sixth.
   */
  app.get("/ws", async (c) => {
    // A handshake cannot be performed on an upgrade -- there is nowhere to
    // redirect a WebSocket to. The page load resolves it first, so this only
    // means "reload and try again".
    const auth = await deps.authenticate(c.req.raw);
    if (auth.kind !== "signed-in") return c.json({ error: "AUTH_FAILED" }, 401);
    const accountId = auth.accountId;

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

/**
 * Clerk's handshake headers carry a redirect and the cookies that complete it.
 * Dropping them leaves the browser looping through sign-in forever, so they
 * are passed through verbatim.
 */
function handshake(auth: Extract<AuthResult, { kind: "handshake" }>): Response {
  const location = auth.headers.get("location");
  return new Response(null, { status: location ? 307 : 401, headers: auth.headers });
}
