import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  LOBBY_TTL_MS,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_LENGTH,
  bucketKey,
  type BucketKey,
  type Buckets,
} from "@radshare/protocol";
import { openDatabase } from "./db.ts";
import { IgnRequiredError, Lobbies, upsertAccount } from "./lobby.ts";
import { planMatch } from "./matcher.ts";
import { ReadyGates, type Gate } from "./readygate.ts";

const AXI = bucketKey("/Lotus/Types/Game/Projections/T4VoidProjectionGaussPrimeDBronze", "radiant");

/** The vendored WFCD lookup, stubbed to the display name the host pastes. */
const relicNames = () => "Axi G9";

function seeded(): Database {
  const db = openDatabase();
  withIgns(db);
  return db;
}

function setup(): { db: Database; lobbies: Lobbies } {
  const db = openDatabase();
  withIgns(db);
  let n = 0;
  let c = 0;
  const lobbies = new Lobbies(
    db,
    relicNames,
    () => `lob${(n += 1)}`,
    () => `CODE${(c += 1)}`.slice(0, 6).padEnd(6, "Z"),
  );
  return { db, lobbies };
}

/** Four people into one bucket, all four confirmed, gate ready to become a lobby. */
function confirmedGate(startAt = 1000): Gate {
  const buckets: Buckets = new Map();
  let plan;
  for (const [i, id] of ["p1", "p2", "p3", "p4"].entries()) {
    const r = planMatch(buckets, { accountId: id, selection: [AXI] as BucketKey[] }, startAt + i);
    if (!r.ok) throw new Error(r.error);
    plan = r.plan;
  }
  const gates = new ReadyGates(() => "g1");
  const gate = gates.open(plan!.readyCheck!, plan!.evicted, 5000);
  for (const id of ["p1", "p2", "p3", "p4"]) gates.confirm(gate.gateId, id, 6000);
  return gate;
}

/**
 * An account cannot exist without an IGN, so every test that creates a lobby
 * creates these first. There is no nameless-member fixture because there is no
 * nameless member.
 */
function withIgns(db: Database) {
  upsertAccount(db, { accountId: "p1", ign: "zylok", platform: "pc", masteryRank: 30 }, 1);
  upsertAccount(db, { accountId: "p2", ign: "mirefall", platform: "pc" }, 1);
  upsertAccount(db, { accountId: "p3", ign: "kavatkin", platform: "xbox", masteryRank: 12 }, 1);
  upsertAccount(db, { accountId: "p4", ign: "orokinned", platform: "pc" }, 1);
}

describe("creating a lobby from a completed gate", () => {
  test("all four members land in slot order, longest waiter first", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    const rows = db
      .query<{ account_id: string; slot: number }, [string]>(
        "SELECT account_id, slot FROM lobby_members WHERE lobby_id = ? ORDER BY slot",
      )
      .all(lobbyId);
    expect(rows.map((r) => r.account_id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(rows.map((r) => r.slot)).toEqual([0, 1, 2, 3]);
  });

  test("the host is the longest waiter, carried from the gate", () => {
    const { lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    expect(lobbies.viewFor(lobbyId, "p2")!.hostAccountId).toBe("p1");
  });

  test("enqueuedAt is copied from the bucket entry, which no longer exists", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(1000), 9000);

    const rows = db
      .query<{ enqueued_at: number; matched_at: number }, [string]>(
        "SELECT enqueued_at, matched_at FROM lobby_members WHERE lobby_id = ? ORDER BY slot",
      )
      .all(lobbyId);
    expect(rows.map((r) => r.enqueued_at)).toEqual([1000, 1001, 1002, 1003]);
    expect(rows.every((r) => r.matched_at === 9000)).toBe(true);
  });

  test("expiry is two hours from creation", () => {
    const { lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    const view = lobbies.viewFor(lobbyId, "p1")!;
    expect(view.expiresAt - view.createdAt).toBe(LOBBY_TTL_MS);
    expect(LOBBY_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  test("creation records a match_fired event and nothing else", () => {
    const { db, lobbies } = setup();
    lobbies.create(confirmedGate(), 9000);
    const rows = db.query<{ type: string }, []>("SELECT type FROM events").all();
    expect(rows.map((r) => r.type)).toEqual(["match_fired"]);
  });

  test("there is no ratings table; reputation does not exist", () => {
    const { db } = setup();
    const names = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    expect(names).not.toContain("ratings");
    expect(names.some((n) => n.includes("rating") || n.includes("reputation"))).toBe(false);
  });
});

describe("the share code", () => {
  test("is six characters from an alphabet with no confusable letters", () => {
    const { lobbies } = setup();
    const real = new Lobbies(seeded(), relicNames);
    const { shareCode } = real.create(confirmedGate(), 9000);

    expect(shareCode).toHaveLength(SHARE_CODE_LENGTH);
    for (const ch of shareCode) expect(SHARE_CODE_ALPHABET).toContain(ch);
    for (const confusable of ["I", "L", "O", "U"]) {
      expect(SHARE_CODE_ALPHABET).not.toContain(confusable);
    }
    expect(lobbies).toBeDefined();
  });

  test("carries no information about the relic or the lobby", () => {
    const real = new Lobbies(seeded(), relicNames);
    const { lobbyId, shareCode } = real.create(confirmedGate(), 9000);
    expect(shareCode).not.toContain("AXI");
    expect(shareCode).not.toContain("G9");
    expect(shareCode).not.toContain(lobbyId.toUpperCase());
  });

  test("resolves back to its lobby, case-insensitively", () => {
    const { lobbies } = setup();
    const { lobbyId, shareCode } = lobbies.create(confirmedGate(), 9000);
    expect(lobbies.byShareCode(shareCode)).toBe(lobbyId);
    expect(lobbies.byShareCode(shareCode.toLowerCase())).toBe(lobbyId);
  });

  test("an unknown code resolves to nothing", () => {
    const { lobbies } = setup();
    expect(lobbies.byShareCode("ZZZZZZ")).toBeNull();
  });

  test("a generator that keeps colliding fails loudly rather than reusing a code", () => {
    const db = seeded();
    let n = 0;
    const stuck = new Lobbies(db, relicNames, () => `lob${(n += 1)}`, () => "SAME01");
    stuck.create(confirmedGate(1000), 9000);
    expect(() => stuck.create(confirmedGate(2000), 9000)).toThrow(/unused share code/);
  });
});

describe("the asymmetric view", () => {
  test("the host gets a ready-to-paste whisper for the other three", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    const view = lobbies.viewFor(lobbyId, "p1")!;
    expect(view.role).toBe("host");
    const others = view.members.filter((m) => !m.isHost);
    expect(others.map((m) => m.whisper)).toEqual([
      "/w mirefall radshare Axi G9 Radiant",
      "/w kavatkin radshare Axi G9 Radiant",
      "/w orokinned radshare Axi G9 Radiant",
    ]);
  });

  test("the host gets no whisper for their own row", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    const own = lobbies.viewFor(lobbyId, "p1")!.members.find((m) => m.isHost)!;
    expect(own.whisper).toBeUndefined();
  });

  test("a non-host gets NO whisper data at all, not a disabled one", () => {
    // Twelve whispers and colliding invites is the failure this prevents, and
    // the cheapest prevention is never sending a member the data to build one.
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    const view = lobbies.viewFor(lobbyId, "p3")!;
    expect(view.role).toBe("member");
    for (const m of view.members) expect(m).not.toHaveProperty("whisper");
  });

  test("a member is told which name to wait on; the host is not", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    expect(lobbies.viewFor(lobbyId, "p3")!.hostIgn).toBe("zylok");
    expect(lobbies.viewFor(lobbyId, "p1")!.hostIgn).toBeNull();
  });

  test("each viewer sees exactly one row marked as themselves", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    for (const id of ["p1", "p2", "p3", "p4"]) {
      const you = lobbies.viewFor(lobbyId, id)!.members.filter((m) => m.isYou);
      expect(you).toHaveLength(1);
      expect(you[0]!.accountId).toBe(id);
    }
  });

  test("every member has a name and every non-host row a usable whisper", () => {
    const { lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    const view = lobbies.viewFor(lobbyId, "p1")!;
    for (const m of view.members) expect(m.ign.length).toBeGreaterThan(0);
    for (const m of view.members.filter((x) => !x.isHost)) {
      expect(m.whisper).toContain(m.ign);
    }
  });

  test("there is no readiness anywhere in the view", () => {
    // A lobby exists only once all four passed the gate, so everyone here has
    // already confirmed. A readiness field would be a second, weaker gate.
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    const view = lobbies.viewFor(lobbyId, "p1")!;
    const keys = Object.keys(view.members[0]!).join(" ").toLowerCase();
    expect(keys).not.toContain("ready");
    expect(JSON.stringify(view).toLowerCase()).not.toContain("ready");
  });

  test("mastery rank and platform are carried when set and null when not", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    const members = lobbies.viewFor(lobbyId, "p1")!.members;
    expect(members.find((m) => m.accountId === "p3")!.masteryRank).toBe(12);
    expect(members.find((m) => m.accountId === "p3")!.platform).toBe("xbox");
    expect(members.find((m) => m.accountId === "p2")!.masteryRank).toBeNull();
  });

  test("the reference line shows the format without naming anyone", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    expect(lobbies.viewFor(lobbyId, "p3")!.whisperFormat).toBe(
      "/w <name> radshare Axi G9 Radiant",
    );
  });

  test("IGNs are plain -- no discriminator is invented anywhere", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    expect(JSON.stringify(lobbies.viewFor(lobbyId, "p1"))).not.toContain("#");
  });

  test("an unknown lobby is null rather than an empty shell", () => {
    const { lobbies } = setup();
    expect(lobbies.viewFor("nope", "p1")).toBeNull();
  });
});

describe("leaving", () => {
  test("the lobby continues at three and the row stays visible", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    expect(lobbies.leave(lobbyId, "p4", 9500).dissolved).toBe(false);
    const view = lobbies.viewFor(lobbyId, "p1")!;
    expect(view.members).toHaveLength(4);
    expect(view.members.find((m) => m.accountId === "p4")!.hasLeft).toBe(true);
    expect(view.closedAt).toBeNull();
  });

  test("a member who left still carries a whisper on the host's view", () => {
    // The host needs to know who was already whispered, which is why the row is
    // marked rather than removed.
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    lobbies.leave(lobbyId, "p4", 9500);

    const p4 = lobbies.viewFor(lobbyId, "p1")!.members.find((m) => m.accountId === "p4")!;
    expect(p4.whisper).toBe("/w orokinned radshare Axi G9 Radiant");
  });

  test("the last member leaving dissolves the lobby", () => {
    const { lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    for (const id of ["p1", "p2", "p3"]) {
      expect(lobbies.leave(lobbyId, id, 9500).dissolved).toBe(false);
    }
    expect(lobbies.leave(lobbyId, "p4", 9500).dissolved).toBe(true);
    expect(lobbies.isOpen(lobbyId, 9600)).toBe(false);
  });

  test("leaving twice is a no-op", () => {
    const { lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    expect(lobbies.leave(lobbyId, "p4", 9500).dissolved).toBe(false);
    expect(lobbies.leave(lobbyId, "p4", 9600).dissolved).toBe(false);
    expect(lobbies.isOpen(lobbyId, 9700)).toBe(true);
  });

  test("the host leaving does not reassign the role", () => {
    // No host handoff. Members press Queue again instead.
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    lobbies.leave(lobbyId, "p1", 9500);

    const view = lobbies.viewFor(lobbyId, "p2")!;
    expect(view.hostAccountId).toBe("p1");
    expect(view.role).toBe("member");
    expect(view.members.find((m) => m.isHost)!.hasLeft).toBe(true);
  });
});

describe("abandoning the browser is never punished", () => {
  test("a disconnected member is still a member", () => {
    // The happy path: read the names, alt-tab into Warframe, close the tab.
    // Nothing in the lobby layer observes sockets, so there is no path by which
    // this removes anyone.
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    const later = 9000 + 60 * 60 * 1000;
    expect(lobbies.isOpen(lobbyId, later)).toBe(true);
    expect(lobbies.viewFor(lobbyId, "p4")!.members.every((m) => !m.hasLeft)).toBe(true);
    expect(lobbies.openLobbyFor("p4", later)).toBe(lobbyId);
  });
});

describe("reconnect", () => {
  test("is derived from the account, so a second device finds the lobby", () => {
    const { lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    expect(lobbies.openLobbyFor("p3", 9500)).toBe(lobbyId);
  });

  test("returns nothing once you have left", () => {
    const { lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    lobbies.leave(lobbyId, "p3", 9500);
    expect(lobbies.openLobbyFor("p3", 9600)).toBeNull();
  });

  test("returns nothing once the lobby has expired", () => {
    const { lobbies } = setup();
    lobbies.create(confirmedGate(), 9000);
    expect(lobbies.openLobbyFor("p3", 9000 + LOBBY_TTL_MS + 1)).toBeNull();
  });

  test("returns nothing for someone who was never in one", () => {
    const { lobbies } = setup();
    lobbies.create(confirmedGate(), 9000);
    expect(lobbies.openLobbyFor("stranger", 9500)).toBeNull();
  });

  test("an account in one open lobby gets exactly that one", () => {
    const { lobbies } = setup();
    const a = lobbies.create(confirmedGate(1000), 9000);
    lobbies.leave(a.lobbyId, "p1", 9100);
    lobbies.leave(a.lobbyId, "p2", 9100);
    lobbies.leave(a.lobbyId, "p3", 9100);
    lobbies.leave(a.lobbyId, "p4", 9100);

    const b = lobbies.create(confirmedGate(2000), 9200);
    expect(lobbies.openLobbyFor("p1", 9300)).toBe(b.lobbyId);
  });
});

describe("dissolution", () => {
  test("a lobby closes at its two-hour ceiling", () => {
    const { lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    expect(lobbies.expire(9000 + LOBBY_TTL_MS - 1)).toEqual([]);
    expect(lobbies.expire(9000 + LOBBY_TTL_MS)).toEqual([lobbyId]);
    expect(lobbies.isOpen(lobbyId, 9000 + LOBBY_TTL_MS)).toBe(false);
  });

  test("closing is idempotent", () => {
    const { lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    expect(lobbies.close(lobbyId, 9500)).toBe(true);
    expect(lobbies.close(lobbyId, 9600)).toBe(false);
  });

  test("a closed lobby is still readable, so the client can say it closed", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    lobbies.close(lobbyId, 9500);

    const view = lobbies.viewFor(lobbyId, "p2");
    expect(view).not.toBeNull();
    expect(view!.closedAt).toBe(9500);
  });
});

describe("an in-game name is required", () => {
  test("an account cannot be created without one", () => {
    const db = openDatabase();
    expect(() => upsertAccount(db, { accountId: "x", ign: "" }, 1)).toThrow(/in-game name/);
    expect(() => upsertAccount(db, { accountId: "x", ign: "   " }, 1)).toThrow(/in-game name/);
  });

  test("the error carries the wire code, so the caller does not map it by hand", () => {
    const db = openDatabase();
    try {
      upsertAccount(db, { accountId: "x", ign: " " }, 1);
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as IgnRequiredError).code).toBe("IGN_REQUIRED");
    }
  });

  test("surrounding whitespace is trimmed rather than stored", () => {
    const db = openDatabase();
    upsertAccount(db, { accountId: "x", ign: "  zylok  " }, 1);
    const row = db
      .query<{ ign: string }, [string]>("SELECT ign FROM accounts WHERE account_id = ?")
      .get("x")!;
    expect(row.ign).toBe("zylok");
  });

  test("the database refuses a blank name even if application code is bypassed", () => {
    // Two independent guards. A future migration or a careless raw insert must
    // not be able to produce a nameless account.
    const db = openDatabase();
    const insert = (ign: string | null) =>
      db
        .query("INSERT INTO accounts (account_id, ign, created_at) VALUES (?, ?, ?)")
        .run("raw", ign, 1);
    expect(() => insert(null)).toThrow();
    expect(() => insert("")).toThrow();
    expect(() => insert("  ")).toThrow();
  });

  test("a lobby member cannot exist without an account, so a name is always present", () => {
    const db = openDatabase();
    const lobbies = new Lobbies(db, relicNames);
    expect(() => lobbies.create(confirmedGate(), 9000)).toThrow(/FOREIGN KEY/);
  });

  test("an over-long name is rejected", () => {
    const db = openDatabase();
    expect(() => upsertAccount(db, { accountId: "x", ign: "z".repeat(25) }, 1)).toThrow();
    expect(() => upsertAccount(db, { accountId: "y", ign: "z".repeat(24) }, 1)).not.toThrow();
  });
});

describe("capacity is enforced by the database", () => {
  test("a fifth member cannot be inserted into an occupied slot", () => {
    // "Read the count, then insert" is a race. Two people entering the same
    // code for a 3/4 lobby both read three and both insert. The constraint is
    // what actually prevents a five-person squad.
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    expect(() =>
      db
        .query(
          `INSERT INTO lobby_members (lobby_id, account_id, slot, enqueued_at, matched_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(lobbyId, "gatecrasher", 3, 1000, 9000),
    ).toThrow();
  });

  test("there is no fifth slot to insert into", () => {
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);

    expect(() =>
      db
        .query(
          `INSERT INTO lobby_members (lobby_id, account_id, slot, enqueued_at, matched_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(lobbyId, "gatecrasher", 4, 1000, 9000),
    ).toThrow();
  });

  test("a vacated slot becomes free again", () => {
    // The index is partial on left_at. Nothing uses this yet -- it is what T18
    // needs, and getting it wrong now would be a migration later.
    const { db, lobbies } = setup();
    const { lobbyId } = lobbies.create(confirmedGate(), 9000);
    lobbies.leave(lobbyId, "p4", 9500);
    upsertAccount(db, { accountId: "friend", ign: "latecomer", platform: "pc" }, 9500);

    expect(() =>
      db
        .query(
          `INSERT INTO lobby_members (lobby_id, account_id, slot, enqueued_at, matched_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(lobbyId, "friend", 3, 9500, 9500),
    ).not.toThrow();
  });
});
