import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  READY_WINDOW_MS,
  bucketKey,
  type BucketKey,
  type ServerMessage,
} from "@radshare/protocol";
import { openDatabase } from "./db.ts";
import { Hub } from "./hub.ts";
import { upsertAccount } from "./lobby.ts";

const AXI = bucketKey("Axi A2", "radiant");
const MESO = bucketKey("Meso B4", "radiant");

type Sent = { to: string; msg: ServerMessage };

/**
 * A hub with a hand-cranked clock and a captured outbound sink.
 *
 * Accounts are seeded because an account cannot queue without an in-game name,
 * so an unseeded hub is not a realistic starting state. `nameless` is left out
 * on purpose, for the tests that check the guard.
 */
function harness() {
  const db: Database = openDatabase();
  seedAccounts(db, ["a", "b", "c", "d"]);
  const sent: Sent[] = [];
  let clock = 1000;

  const hub = new Hub({
    db,
    relicName: (id) => id,
    send: (to, msg) => sent.push({ to, msg }),
    now: () => clock,
  });

  return {
    db,
    hub,
    sent,
    advance(ms: number) {
      clock += ms;
    },
    at(ms: number) {
      clock = ms;
    },
    /** Every message a given connection received, in order. */
    to(connectionId: string) {
      return sent.filter((s) => s.to === connectionId).map((s) => s.msg);
    },
    ofType<T extends ServerMessage["type"]>(connectionId: string, type: T) {
      return sent
        .filter((s) => s.to === connectionId && s.msg.type === type)
        .map((s) => s.msg as Extract<ServerMessage, { type: T }>);
    },
    clear() {
      sent.length = 0;
    },
  };
}

function seedAccounts(db: Database, ids: string[]) {
  for (const [i, id] of ids.entries()) {
    upsertAccount(db, { accountId: id, ign: `tenno${i}`, platform: "pc" }, 1);
  }
}

describe("connecting", () => {
  test("a new socket gets a snapshot immediately", () => {
    const h = harness();
    h.hub.open("c1", "a");
    expect(h.to("c1")[0]?.type).toBe("board.snapshot");
  });

  test("an unqueued account lands in global mode", () => {
    const h = harness();
    h.hub.open("c1", "a");
    const snap = h.ofType("c1", "board.snapshot")[0]!;
    expect(snap.mode).toBe("global");
    expect(snap.you.buckets).toEqual([]);
  });

  test("a second device for a queued account lands in personal mode unprompted", () => {
    // Queue entries are account-keyed and survive a socket swap. The client
    // never has to re-send queue.join, which would reset enqueuedAt.
    const h = harness();
    h.hub.open("desktop", "a");
    h.hub.handle("desktop", { type: "queue.join", selection: [AXI] });
    h.clear();

    h.hub.open("phone", "a");
    const snap = h.ofType("phone", "board.snapshot")[0]!;
    expect(snap.mode).toBe("personal");
    expect(snap.you.buckets).toEqual([{ bucketKey: AXI, count: 1 }]);
  });

  test("an account may hold several sockets", () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.hub.open("c2", "a");
    expect(h.hub.connectionCount).toBe(2);
    expect(h.hub.presence.socketCount("a")).toBe(2);
  });
});

describe("queueing", () => {
  test("a join creates the bucket with you in it", () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });
    expect(h.hub.buckets.get(AXI)).toHaveLength(1);
  });

  test("queueing swaps your own board to personal and tells everyone else", () => {
    // The swap arrives as a SNAPSHOT, not a delta: global rows and your own
    // rows are different sets, and no sequence of per-row deltas says "throw
    // the board away and render this instead". Onlookers get an ordinary delta.
    const h = harness();
    h.hub.open("c1", "a");
    h.hub.open("c2", "b");
    h.clear();

    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });
    expect(h.ofType("c1", "board.snapshot")[0]!.mode).toBe("personal");
    expect(h.ofType("c1", "board.delta")).toHaveLength(0);
    expect(h.ofType("c2", "board.delta")[0]!.mode).toBe("global");
  });

  test("leaving the queue swaps back, also as a snapshot", () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });
    h.clear();

    h.hub.handle("c1", { type: "queue.leave" });
    expect(h.ofType("c1", "board.snapshot")[0]!.mode).toBe("global");
  });

  test("a change within a mode stays a delta", () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });
    h.hub.open("c2", "b");
    h.clear();

    h.hub.handle("c2", { type: "queue.join", selection: [AXI] });
    expect(h.ofType("c1", "board.snapshot")).toHaveLength(0);
    expect(h.ofType("c1", "board.delta")[0]!.mode).toBe("personal");
  });

  test("leaving the queue clears every bucket", () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.hub.handle("c1", { type: "queue.join", selection: [AXI, MESO] });
    h.hub.handle("c1", { type: "queue.leave" });
    expect(h.hub.buckets.size).toBe(0);
  });

  test("a join beyond the cap is refused whole, with a code", () => {
    const h = harness();
    h.hub.open("c1", "a");
    const tooMany = Array.from({ length: 21 }, (_, i) => bucketKey(`R${i}`, "radiant"));
    h.clear();

    h.hub.handle("c1", { type: "queue.join", selection: tooMany });
    expect(h.ofType("c1", "error")[0]!.code).toBe("QUEUE_CAP_EXCEEDED");
    expect(h.hub.buckets.size).toBe(0);
  });

  test("a bucket key with an unknown refinement is rejected before it creates a bucket", () => {
    // The socket is a public surface even when authenticated. Without this a
    // client can fill the board with rows that resolve to nothing.
    const h = harness();
    h.hub.open("c1", "a");
    h.clear();

    h.hub.handle("c1", { type: "queue.join", selection: ["Axi A2:shiny" as BucketKey] });
    expect(h.ofType("c1", "error")[0]!.code).toBe("MATCH_FAILED");
    expect(h.hub.buckets.size).toBe(0);
  });

  test("an unknown relic is rejected when a relic list is loaded", () => {
    const db = openDatabase();
    const sent: Sent[] = [];
    seedAccounts(db, ["a"]);
    const hub = new Hub({
      db,
      relicName: (id) => id,
      send: (to, msg) => sent.push({ to, msg }),
      now: () => 1000,
      knownRelic: (id) => id === "Axi A2",
    });
    hub.open("c1", "a");
    hub.handle("c1", { type: "queue.join", selection: [bucketKey("Nonexistent", "radiant")] });

    expect(sent.some((s) => s.msg.type === "error")).toBe(true);
    expect(hub.buckets.size).toBe(0);
  });
});

describe("a bucket reaching four", () => {
  function fourQueued() {
    const h = harness();
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      h.hub.open(`c${i + 1}`, id);
    }
    h.clear();
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      h.at(1000 + i);
      h.hub.handle(`c${i + 1}`, { type: "queue.join", selection: [AXI] });
      void id;
    }
    return h;
  }

  test("opens a ready check, not a lobby", () => {
    const h = fourQueued();
    expect(h.ofType("c1", "ready.check")).toHaveLength(1);
    expect(h.ofType("c1", "lobby.state")).toHaveLength(0);
    expect(h.hub.gates.size).toBe(1);
  });

  test("empties the bucket in the same pass", () => {
    const h = fourQueued();
    expect(h.hub.buckets.get(AXI)).toBeUndefined();
  });

  test("tells all four, with a deadline and nobody pre-confirmed", () => {
    const h = fourQueued();
    for (const c of ["c1", "c2", "c3", "c4"]) {
      const check = h.ofType(c, "ready.check")[0]!;
      expect(check.members.map((m) => m.confirmed)).toEqual([false, false, false, false]);
      expect(check.deadlineAt).toBe(1003 + READY_WINDOW_MS);
    }
  });

  test("three confirmations broadcast state and create nothing", () => {
    const h = fourQueued();
    const gateId = h.ofType("c1", "ready.check")[0]!.gateId;
    h.clear();

    for (const c of ["c1", "c2", "c3"]) h.hub.handle(c, { type: "ready.confirm", gateId });
    expect(h.ofType("c4", "ready.state").at(-1)!.members.filter((m) => m.confirmed)).toHaveLength(3);
    expect(h.ofType("c1", "match.found")).toHaveLength(0);
  });

  test("the fourth creates the lobby and routes everyone to it", () => {
    const h = fourQueued();
    const gateId = h.ofType("c1", "ready.check")[0]!.gateId;
    h.clear();

    for (const c of ["c1", "c2", "c3", "c4"]) h.hub.handle(c, { type: "ready.confirm", gateId });

    for (const c of ["c1", "c2", "c3", "c4"]) {
      expect(h.ofType(c, "match.found")).toHaveLength(1);
      expect(h.ofType(c, "lobby.state")).toHaveLength(1);
    }
    expect(h.hub.gates.size).toBe(0);
  });

  test("the lobby is asymmetric: only the host is handed whispers", () => {
    const h = fourQueued();
    const gateId = h.ofType("c1", "ready.check")[0]!.gateId;
    h.clear();
    for (const c of ["c1", "c2", "c3", "c4"]) h.hub.handle(c, { type: "ready.confirm", gateId });

    const hostView = h.ofType("c1", "lobby.state")[0]!.lobby;
    const memberView = h.ofType("c3", "lobby.state")[0]!.lobby;

    expect(hostView.role).toBe("host");
    expect(hostView.members.filter((m) => !m.isHost).every((m) => m.whisper)).toBe(true);
    expect(memberView.role).toBe("member");
    for (const m of memberView.members) expect(m).not.toHaveProperty("whisper");
  });

  test("a gate that times out returns confirmers and removes the rest", () => {
    const h = fourQueued();
    const gateId = h.ofType("c1", "ready.check")[0]!.gateId;
    h.hub.handle("c1", { type: "ready.confirm", gateId });
    h.hub.handle("c2", { type: "ready.confirm", gateId });
    h.clear();

    h.advance(READY_WINDOW_MS);
    h.hub.expireGates();

    expect(h.ofType("c1", "ready.failed")[0]!.reason).toBe("someone-did-not-confirm");
    expect(h.ofType("c3", "ready.failed")[0]!.reason).toBe("you-did-not-confirm");
    expect(h.hub.buckets.get(AXI)!.map((e) => e.accountId)).toEqual(["a", "b"]);
  });

  test("confirmers come back with their ORIGINAL position", () => {
    const h = fourQueued();
    const gateId = h.ofType("c1", "ready.check")[0]!.gateId;
    h.hub.handle("c1", { type: "ready.confirm", gateId });
    h.advance(READY_WINDOW_MS);
    h.hub.expireGates();

    expect(h.hub.buckets.get(AXI)!.map((e) => e.enqueuedAt)).toEqual([1000]);
  });

  test("a failed gate is recorded once, and no lobby is written", () => {
    const h = fourQueued();
    h.advance(READY_WINDOW_MS);
    h.hub.expireGates();

    const events = h.db
      .query<{ type: string }, []>("SELECT type FROM events")
      .all()
      .map((r) => r.type);
    expect(events).toEqual(["ready_gate_failed"]);
    expect(h.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM lobbies").get()!.n).toBe(0);
  });

  test("nobody is silently dropped -- all four are addressed", () => {
    const h = fourQueued();
    const gateId = h.ofType("c1", "ready.check")[0]!.gateId;
    h.hub.handle("c2", { type: "ready.confirm", gateId });
    h.clear();

    h.advance(READY_WINDOW_MS);
    h.hub.expireGates();

    for (const c of ["c1", "c2", "c3", "c4"]) {
      expect(h.ofType(c, "ready.failed")).toHaveLength(1);
    }
  });

  test("a member vanishing mid-gate fails it at once, not after 60s", () => {
    const h = fourQueued();
    const gateId = h.ofType("c1", "ready.check")[0]!.gateId;
    h.hub.handle("c1", { type: "ready.confirm", gateId });
    h.clear();

    h.advance(500);
    h.hub.close("c3");

    expect(h.ofType("c1", "ready.failed")[0]!.reason).toBe("someone-did-not-confirm");
    expect(h.hub.gates.size).toBe(0);
    expect(h.hub.buckets.get(AXI)!.map((e) => e.accountId)).toEqual(["a"]);
  });
});

describe("an instant match", () => {
  test("never renders a personal board", () => {
    const h = harness();
    for (const [i, id] of ["a", "b", "c"].entries()) {
      h.at(1000 + i);
      h.hub.open(`c${i + 1}`, id);
      h.hub.handle(`c${i + 1}`, { type: "queue.join", selection: [AXI] });
    }
    h.at(1003);
    h.hub.open("c4", "d");
    h.clear();

    h.hub.handle("c4", { type: "queue.join", selection: [AXI] });

    expect(h.ofType("c4", "ready.check")).toHaveLength(1);
    // The joiner was evicted in the same pass, so they were never queued and
    // the board never left global mode.
    for (const m of h.to("c4")) {
      if (m.type === "board.delta" || m.type === "board.snapshot") expect(m.mode).toBe("global");
    }
  });
});

describe("disconnecting", () => {
  test("closing one socket of two evicts nothing", () => {
    const h = harness();
    h.hub.open("desktop", "a");
    h.hub.open("phone", "a");
    h.hub.handle("desktop", { type: "queue.join", selection: [AXI] });

    h.hub.close("phone");
    expect(h.hub.buckets.get(AXI)).toHaveLength(1);
  });

  test("the last socket closing empties every bucket the account held", () => {
    const h = harness();
    h.hub.open("desktop", "a");
    h.hub.open("phone", "a");
    h.hub.handle("desktop", { type: "queue.join", selection: [AXI, MESO] });

    h.hub.close("phone");
    h.hub.close("desktop");
    expect(h.hub.buckets.size).toBe(0);
  });

  test("a clean close and a dead router are indistinguishable here", () => {
    // There is no close-code branch and no grace window: the board must not
    // vouch for someone who is not connected, whatever the reason.
    const h = harness();
    h.hub.open("c1", "a");
    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });
    h.hub.close("c1");
    expect(h.hub.buckets.size).toBe(0);
  });

  test("other clients see the bucket shrink", () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.hub.open("c2", "b");
    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });
    h.clear();

    h.hub.close("c1");
    expect(h.ofType("c2", "board.delta").at(-1)!.rows).toEqual([
      { bucketKey: AXI, count: 0, inBoard: false },
    ]);
  });

  test("closing an unknown connection is a no-op", () => {
    const h = harness();
    expect(() => h.hub.close("ghost")).not.toThrow();
  });
});

describe("the lobby outlives the socket", () => {
  function matched() {
    const h = harness();
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      h.at(1000 + i);
      h.hub.open(`c${i + 1}`, id);
      h.hub.handle(`c${i + 1}`, { type: "queue.join", selection: [AXI] });
    }
    const gateId = h.ofType("c1", "ready.check")[0]!.gateId;
    for (const c of ["c1", "c2", "c3", "c4"]) h.hub.handle(c, { type: "ready.confirm", gateId });
    return h;
  }

  test("alt-tabbing away and closing the tab costs nothing", () => {
    // The documented happy path: read the names, go play, abandon the browser.
    const h = matched();
    h.hub.close("c4");
    expect(h.hub.lobbies.openLobbyFor("d", 9999)).not.toBeNull();
  });

  test("a returning socket is handed its lobby without asking", () => {
    const h = matched();
    h.hub.close("c2");
    h.clear();

    h.hub.open("c2b", "b");
    expect(h.ofType("c2b", "lobby.state")).toHaveLength(1);
  });

  test("rejoin is derived from the account, so a new device works", () => {
    const h = matched();
    h.hub.open("tablet", "b");
    h.clear();

    h.hub.handle("tablet", { type: "lobby.rejoin" });
    expect(h.ofType("tablet", "lobby.state")).toHaveLength(1);
  });

  test("rejoining with no open lobby says so rather than hanging", () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.clear();
    h.hub.handle("c1", { type: "lobby.rejoin" });
    expect(h.ofType("c1", "error")[0]!.code).toBe("LOBBY_CLOSED");
  });

  test("leaving marks you gone and the others still see the row", () => {
    const h = matched();
    const lobbyId = h.ofType("c1", "lobby.state")[0]!.lobby.lobbyId;
    h.clear();

    h.hub.handle("c4", { type: "lobby.leave", lobbyId });
    const hostView = h.ofType("c1", "lobby.state").at(-1)!.lobby;
    expect(hostView.members).toHaveLength(4);
    expect(hostView.members.find((m) => m.accountId === "d")!.hasLeft).toBe(true);
  });

  test("the last member leaving closes it for everyone", () => {
    const h = matched();
    const lobbyId = h.ofType("c1", "lobby.state")[0]!.lobby.lobbyId;
    for (const c of ["c1", "c2", "c3"]) h.hub.handle(c, { type: "lobby.leave", lobbyId });
    h.clear();

    h.hub.handle("c4", { type: "lobby.leave", lobbyId });
    expect(h.ofType("c4", "lobby.closed")).toHaveLength(1);
  });

  test("a lobby past its ceiling is dissolved by the sweep", () => {
    const h = matched();
    h.advance(2 * 60 * 60 * 1000 + 1);
    h.clear();

    h.hub.expireLobbies();
    expect(h.ofType("c1", "lobby.closed")).toHaveLength(1);
  });
});

describe("signing up is not finished until a name is set", () => {
  test("queueing without an account row is refused with a clear code", () => {
    // Checked at JOIN, not at match time. Discovering it when the lobby is
    // written would fail a match three other people had already confirmed.
    const h = harness();
    h.hub.open("c1", "nameless");
    h.clear();

    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });
    expect(h.ofType("c1", "error")[0]!.code).toBe("IGN_REQUIRED");
    expect(h.hub.buckets.size).toBe(0);
  });

  test("an empty selection is still allowed, so leaving never traps you", () => {
    const h = harness();
    h.hub.open("c1", "nameless");
    h.clear();
    h.hub.handle("c1", { type: "queue.join", selection: [] });
    expect(h.ofType("c1", "error")).toHaveLength(0);
  });

  test("a named account queues normally", () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.clear();

    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });
    expect(h.ofType("c1", "error")).toHaveLength(0);
    expect(h.hub.buckets.get(AXI)).toHaveLength(1);
  });
});

describe("a failed lobby write puts everyone back", () => {
  test("four confirmed people are not stranded when the insert throws", () => {
    // The gate is already closed by the time the write runs. Without the
    // restore these four are out of every bucket they held with nothing to
    // show for it -- the exact failure the ready gate exists to prevent.
    const h = harness();
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      h.at(1000 + i);
      h.hub.open(`c${i + 1}`, id);
      h.hub.handle(`c${i + 1}`, { type: "queue.join", selection: [AXI] });
    }
    const gateId = h.ofType("c1", "ready.check")[0]!.gateId;

    // Make the write fail the way a real constraint violation would.
    h.db.exec("DROP TABLE lobby_members");
    h.clear();
    for (const c of ["c1", "c2", "c3", "c4"]) h.hub.handle(c, { type: "ready.confirm", gateId });

    for (const c of ["c1", "c2", "c3", "c4"]) {
      expect(h.ofType(c, "error")[0]!.code).toBe("MATCH_FAILED");
      expect(h.ofType(c, "match.found")).toHaveLength(0);
    }

    // Restoring four people into the bucket they came from completes it, so it
    // fires again — a fresh ready check over the same four. That is the
    // documented behaviour of planRestore and the right one here: for a
    // transient write failure it retries the match, and for a permanent one it
    // cannot loop, because firing again needs four more confirmations.
    expect(h.hub.gates.size).toBe(1);
    const retry = h.hub.gates.gateFor("a")!;
    expect(retry.members.map((m) => m.accountId)).toEqual(["a", "b", "c", "d"]);
  });

  test("and they keep their original positions", () => {
    const h = harness();
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      h.at(1000 + i);
      h.hub.open(`c${i + 1}`, id);
      h.hub.handle(`c${i + 1}`, { type: "queue.join", selection: [AXI] });
    }
    const gateId = h.ofType("c1", "ready.check")[0]!.gateId;
    h.db.exec("DROP TABLE lobby_members");
    for (const c of ["c1", "c2", "c3", "c4"]) h.hub.handle(c, { type: "ready.confirm", gateId });

    // Nobody paid for the failure: the retry carries their original positions.
    expect(h.hub.gates.gateFor("a")!.members.map((m) => m.enqueuedAt)).toEqual([
      1000, 1001, 1002, 1003,
    ]);
  });
});

describe("what is not built yet says so", () => {
  test("joining by code is refused rather than half-handled", () => {
    const h = harness();
    h.hub.open("c1", "a");
    h.clear();
    h.hub.handle("c1", { type: "lobby.join_by_code", code: "ABC123" });
    expect(h.ofType("c1", "error")[0]!.code).toBe("CODE_NOT_FOUND");
  });
});

describe("the activity signal is never seeded", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  test("an empty queue reports zero players", () => {
    expect(h.hub.playersQueued()).toBe(0);
  });

  test("it counts distinct accounts, not sockets", () => {
    h.hub.open("desktop", "a");
    h.hub.open("phone", "a");
    h.hub.handle("desktop", { type: "queue.join", selection: [AXI, MESO] });
    expect(h.hub.playersQueued()).toBe(1);
  });

  test("it counts only accounts actually holding an entry", () => {
    h.hub.open("c1", "a");
    h.hub.open("c2", "b");
    h.hub.handle("c1", { type: "queue.join", selection: [AXI] });
    expect(h.hub.playersQueued()).toBe(1);
  });
});
