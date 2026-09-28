import { describe, expect, test } from "bun:test";
import { bucketKey } from "@radshare/protocol";
import { createApp, type AppBindings } from "./app.ts";
import { buildAuthenticator, devAuthenticator, MissingClerkKeyError } from "./auth.ts";
import { openDatabase } from "./db.ts";
import { Hub } from "./hub.ts";
import { upsertAccount } from "./lobby.ts";
import { ConnectionCap } from "./limits.ts";

const AXI = bucketKey("Axi A2", "radiant");

function harness(opts: { authenticate?: (req: Request) => Promise<string | null> } = {}) {
  let clock = 5000;
  const db = openDatabase();
  // An account cannot queue without an in-game name, so an unseeded hub is not
  // a realistic starting state.
  for (const [i, id] of ["a", "b", "account-1"].entries()) {
    upsertAccount(db, { accountId: id, ign: `tenno${i}`, platform: "pc" }, 1);
  }
  const hub = new Hub({
    db,
    relicName: (id) => id,
    send: () => {},
    now: () => clock,
  });
  const cap = new ConnectionCap();
  const upgrades: Parameters<AppBindings["upgrade"]>[0][] = [];

  const app = createApp({
    hub,
    cap,
    authenticate: opts.authenticate ?? (async () => "account-1"),
    now: () => clock,
  });

  const env: AppBindings = {
    peer: "203.0.113.9:51000",
    upgrade: (data) => {
      upgrades.push(data);
      return true;
    },
  };

  return {
    hub,
    cap,
    upgrades,
    at(ms: number) {
      clock = ms;
    },
    get(path: string, headers: Record<string, string> = {}, bindings: Partial<AppBindings> = {}) {
      return app.request(path, { headers }, { ...env, ...bindings });
    },
    post(path: string, body: unknown, headers: Record<string, string> = {}) {
      return app.request(
        path,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        },
        env,
      );
    },
  };
}

describe("GET /api/health", () => {
  test("reports ok", async () => {
    const res = await harness().get("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/board", () => {
  test("needs no authentication -- it is the proof surface", async () => {
    const h = harness({ authenticate: async () => null });
    expect((await h.get("/api/board")).status).toBe(200);
  });

  test("returns real rows", async () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });

    const body = (await (await h.get("/api/board")).json()) as {
      rows: { bucketKey: string; count: number }[];
    };
    expect(body.rows).toEqual([{ bucketKey: AXI, count: 1 }]);
  });

  test("an empty queue returns an empty board rather than a placeholder", async () => {
    const body = (await (await harness().get("/api/board")).json()) as {
      rows: unknown[];
      playersQueued: number;
    };
    expect(body.rows).toEqual([]);
    expect(body.playersQueued).toBe(0);
  });

  test("counts distinct queued accounts, never sockets", async () => {
    const h = harness();
    h.hub.open("desktop", "a");
    h.hub.open("phone", "a");
    h.hub.open("c2", "b");
    h.hub.handle("desktop", { type: "queue.join", selection: [AXI] });

    const body = (await (await h.get("/api/board")).json()) as { playersQueued: number };
    expect(body.playersQueued).toBe(1);
  });

  test("says how stale it is rather than pretending to be live", async () => {
    const h = harness();
    await h.get("/api/board");
    h.at(12_000);

    const body = (await (await h.get("/api/board")).json()) as { updatedAgo: number };
    expect(body.updatedAgo).toBe(7);
  });

  test("its cache header matches the in-process TTL", async () => {
    const res = await harness().get("/api/board");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=10");
  });

  test("a hundred readers cost one projection", async () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });

    const first = (await (await h.get("/api/board")).json()) as { rows: { count: number }[] };
    h.hub.open("c2", "b");
    h.hub.handle("c2", { type: "queue.join", selection: [AXI] });

    const second = (await (await h.get("/api/board")).json()) as { rows: { count: number }[] };
    expect(second.rows[0]!.count).toBe(first.rows[0]!.count);
  });
});

describe("signing up", () => {
  function post(h: ReturnType<typeof harness>, body: unknown, account = "newcomer") {
    return h.post("/api/account", body, { "x-dev-account": account });
  }

  test("a Clerk session alone creates no account", async () => {
    const h = harness({ authenticate: async () => "newcomer" });
    const me = (await (await h.get("/api/me")).json()) as { hasAccount: boolean };
    expect(me.hasAccount).toBe(false);
  });

  test("setting a name creates it", async () => {
    const h = harness({ authenticate: async () => "newcomer" });
    expect((await post(h, { ign: "zylok", platform: "pc" })).status).toBe(200);
    expect(h.hub.hasAccount("newcomer")).toBe(true);
  });

  test("a blank name is refused", async () => {
    const h = harness({ authenticate: async () => "newcomer" });
    for (const ign of ["", "   ", "	"]) {
      const res = await post(h, { ign });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("IGN_REQUIRED");
    }
    expect(h.hub.hasAccount("newcomer")).toBe(false);
  });

  test("a missing name is refused", async () => {
    const h = harness({ authenticate: async () => "newcomer" });
    expect((await post(h, { platform: "pc" })).status).toBe(400);
    expect((await post(h, {})).status).toBe(400);
  });

  test("an unknown platform is dropped rather than stored", async () => {
    const h = harness({ authenticate: async () => "newcomer" });
    await post(h, { ign: "zylok", platform: "dreamcast" });
    const row = h.hub.db
      .query<{ platform: string | null }, [string]>(
        "SELECT platform FROM accounts WHERE account_id = ?",
      )
      .get("newcomer")!;
    expect(row.platform).toBeNull();
  });

  test("mastery rank is optional and absent when unset", async () => {
    const h = harness({ authenticate: async () => "newcomer" });
    await post(h, { ign: "zylok" });
    const row = h.hub.db
      .query<{ mastery_rank: number | null }, [string]>(
        "SELECT mastery_rank FROM accounts WHERE account_id = ?",
      )
      .get("newcomer")!;
    expect(row.mastery_rank).toBeNull();
  });

  test("it requires authentication", async () => {
    const h = harness({ authenticate: async () => null });
    expect((await post(h, { ign: "zylok" })).status).toBe(401);
    expect((await h.get("/api/me")).status).toBe(401);
  });
});

describe("GET /ws", () => {
  test("an unauthenticated upgrade is refused", async () => {
    const h = harness({ authenticate: async () => null });
    const res = await h.get("/ws");
    expect(res.status).toBe(401);
    expect(h.upgrades).toHaveLength(0);
  });

  test("an authenticated upgrade passes the account through", async () => {
    const h = harness();
    const res = await h.get("/ws");
    expect(res.status).toBe(101);
    expect(h.upgrades[0]!.accountId).toBe("account-1");
  });

  test("the cap is enforced at the handshake, before any socket state", async () => {
    const h = harness();
    for (let i = 0; i < 5; i += 1) expect((await h.get("/ws")).status).toBe(101);

    const sixth = await h.get("/ws");
    expect(sixth.status).toBe(429);
    expect(h.upgrades).toHaveLength(5);
  });

  test("the IP comes from X-Forwarded-For, not the peer", async () => {
    // Behind Caddy the peer is a POOLED upstream connection shared between
    // visitors. Keying on it counts the whole userbase as one person and locks
    // everyone out at the sixth connection.
    const h = harness();
    for (let i = 0; i < 5; i += 1) {
      await h.get("/ws", { "x-forwarded-for": "198.51.100.5" }, { peer: "::ffff:127.0.0.1:44321" });
    }
    const other = await h.get(
      "/ws",
      { "x-forwarded-for": "198.51.100.6" },
      { peer: "::ffff:127.0.0.1:44322" },
    );
    expect(other.status).toBe(101);
  });

  test("a failed upgrade releases the slot it reserved", async () => {
    const hub = new Hub({ db: openDatabase(), relicName: (id) => id, send: () => {} });
    const cap = new ConnectionCap();
    const app = createApp({ hub, cap, authenticate: async () => "a" });

    for (let i = 0; i < 6; i += 1) {
      const res = await app.request(
        "/ws",
        { headers: { "x-forwarded-for": "198.51.100.7" } },
        { peer: null, upgrade: () => false },
      );
      expect(res.status).toBe(400);
    }
    expect(cap.count("198.51.100.7")).toBe(0);
  });
});

describe("the auth boundary", () => {
  test("production refuses to start without a Clerk key", () => {
    expect(() => buildAuthenticator({ NODE_ENV: "production" })).toThrow(MissingClerkKeyError);
  });

  test("the dev bypass cannot be switched on in production", () => {
    // A bypass that one variable enables is a bypass that eventually ships.
    expect(() =>
      buildAuthenticator({ NODE_ENV: "production", RADSHARE_DEV_AUTH: "1" }),
    ).toThrow(MissingClerkKeyError);
  });

  test("the dev bypass needs an explicit opt-in, not just a dev environment", () => {
    expect(() => buildAuthenticator({ NODE_ENV: "development" })).toThrow(MissingClerkKeyError);
  });

  test("the dev bypass reads a header when both gates are open", async () => {
    const auth = buildAuthenticator({ NODE_ENV: "development", RADSHARE_DEV_AUTH: "1" });
    const req = new Request("http://x/ws", { headers: { "x-dev-account": "dev-user" } });
    expect(await auth(req)).toBe("dev-user");
  });

  test("the dev bypass grants nothing without the header", async () => {
    expect(await devAuthenticator()(new Request("http://x/ws"))).toBeNull();
  });
});

describe("unknown routes", () => {
  test("404 rather than an upgrade", async () => {
    expect((await harness().get("/api/nope")).status).toBe(404);
  });
});
