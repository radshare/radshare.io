import { describe, expect, test } from "bun:test";
import { bucketKey, type BucketKey, type ServerMessage } from "@radshare/protocol";
import {
  applyDelta,
  applySnapshot,
  backoffMs,
  countsAreLive,
  EMPTY_BOARD,
  isQueued,
  RECONNECT_MAX_MS,
} from "./boardState.ts";
import { Connection, type ClientState } from "./connection.ts";
import { labelFor, waitingCopy } from "./relics.ts";

const AXI = bucketKey("Axi A2", "radiant");
const MESO = bucketKey("Meso B4", "radiant");

/** A fake transport plus a hand-cranked clock and timer queue. */
function harness() {
  let clock = 1000;
  const sent: string[] = [];
  const timers: { fn: () => void; at: number; handle: number }[] = [];
  let nextHandle = 1;
  let live: {
    onOpen: () => void;
    onMessage: (d: string) => void;
    onClose: () => void;
  } | null = null;
  let opened = 0;

  const states: ClientState[] = [];
  const conn = new Connection({
    transport: (handlers) => {
      opened += 1;
      live = handlers;
      return { send: (d) => sent.push(d), close: () => handlers.onClose() };
    },
    onChange: (s) => states.push(s),
    now: () => clock,
    setTimer: (fn, ms) => {
      const handle = nextHandle++;
      timers.push({ fn, at: clock + ms, handle });
      return handle;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.handle === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });

  return {
    conn,
    sent,
    states,
    get openCount() {
      return opened;
    },
    at(ms: number) {
      clock = ms;
    },
    advance(ms: number) {
      clock += ms;
      for (const t of [...timers]) {
        if (t.at <= clock) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
    },
    open() {
      live!.onOpen();
    },
    drop() {
      live!.onClose();
    },
    recv(msg: ServerMessage) {
      live!.onMessage(JSON.stringify(msg));
    },
    parsed() {
      return sent.map((s) => JSON.parse(s));
    },
  };
}

function snapshot(mode: "global" | "personal", rows: [BucketKey, number][], you: [BucketKey, number][] = []): ServerMessage {
  return {
    type: "board.snapshot",
    mode,
    rows: rows.map(([bucketKey, count]) => ({ bucketKey, count })),
    hiddenCount: mode === "global" ? 0 : undefined,
    you: { buckets: you.map(([bucketKey, count]) => ({ bucketKey, count })) },
    at: 1000,
  } as ServerMessage;
}

describe("the board reducer", () => {
  test("a snapshot replaces everything", () => {
    const s = applySnapshot(snapshot("global", [[AXI, 3]]) as never);
    expect(s.mode).toBe("global");
    expect(s.rows).toEqual([{ bucketKey: AXI, count: 3 }]);
  });

  test("a delta updates a count in place", () => {
    const base = applySnapshot(snapshot("global", [[AXI, 2]]) as never);
    const next = applyDelta(
      base,
      { type: "board.delta", mode: "global", rows: [{ bucketKey: AXI, count: 3, inBoard: true }] },
      2000,
    );
    expect(next.rows).toEqual([{ bucketKey: AXI, count: 3 }]);
  });

  test("inBoard false REMOVES the row rather than showing 0/4", () => {
    // 0/4 is not a state the system can be in: an empty bucket is deleted.
    const base = applySnapshot(snapshot("global", [[AXI, 1]]) as never);
    const next = applyDelta(
      base,
      { type: "board.delta", mode: "global", rows: [{ bucketKey: AXI, count: 0, inBoard: false }] },
      2000,
    );
    expect(next.rows).toEqual([]);
  });

  test("rows stay ordered fill-descending and stable", () => {
    const base = applySnapshot(snapshot("global", [[AXI, 1]]) as never);
    const next = applyDelta(
      base,
      {
        type: "board.delta",
        mode: "global",
        rows: [{ bucketKey: MESO, count: 3, inBoard: true }],
      },
      2000,
    );
    expect(next.rows.map((r) => r.bucketKey)).toEqual([MESO, AXI]);
  });

  test("a delta for the wrong mode is dropped, never merged", () => {
    // Merging personal rows into a global board would corrupt the count a
    // stranger is reading.
    const base = applySnapshot(snapshot("global", [[AXI, 2]]) as never);
    const next = applyDelta(
      base,
      { type: "board.delta", mode: "personal", rows: [{ bucketKey: MESO, count: 9, inBoard: true }] },
      2000,
    );
    expect(next).toBe(base);
  });

  test("queued-ness comes from `you`, not from the mode", () => {
    expect(isQueued(EMPTY_BOARD)).toBe(false);
    expect(isQueued(applySnapshot(snapshot("global", [[AXI, 2]], [[MESO, 1]]) as never))).toBe(true);
  });
});

describe("reconnect backoff", () => {
  test("grows and then caps", () => {
    expect(backoffMs(0)).toBe(500);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(4)).toBe(8000);
    expect(backoffMs(30)).toBe(RECONNECT_MAX_MS);
  });

  test("the cap is short enough that the board recovers promptly", () => {
    // A client backed off to two minutes is indistinguishable from one that
    // gave up, and the user is staring at counts that stopped being true.
    expect(RECONNECT_MAX_MS).toBeLessThanOrEqual(15_000);
  });
});

describe("connecting", () => {
  test("opens and reports live", () => {
    const h = harness();
    h.conn.connect();
    expect(h.conn.state.connection).toBe("connecting");
    h.open();
    expect(h.conn.state.connection).toBe("live");
  });

  test("a snapshot on open populates the board", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.recv(snapshot("global", [[AXI, 3]]));
    expect(h.conn.state.board.rows).toEqual([{ bucketKey: AXI, count: 3 }]);
  });
});

describe("the board disowns its counts when the socket dies", () => {
  test("a drop reports reconnecting, not live", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.drop();
    expect(h.conn.state.connection).toBe("reconnecting");
    expect(countsAreLive(h.conn.state.connection)).toBe(false);
  });

  test("the counts stay on screen but are explicitly not live", () => {
    // They are kept so the page does not go blank, and disowned so it is not
    // lying. Both halves matter.
    const h = harness();
    h.conn.connect();
    h.open();
    h.recv(snapshot("global", [[AXI, 3]]));
    h.drop();
    expect(h.conn.state.board.rows).toHaveLength(1);
    expect(countsAreLive(h.conn.state.connection)).toBe(false);
  });

  test("a retry time is published so the bar can count down", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.drop();
    expect(h.conn.state.retryAt).toBe(1000 + 500);
  });

  test("it retries, with a growing gap", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.drop();
    h.advance(500);
    expect(h.openCount).toBe(2);

    h.drop();
    h.advance(999);
    expect(h.openCount).toBe(2);
    h.advance(1);
    expect(h.openCount).toBe(3);
  });

  test("a successful reconnect resets the backoff", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.drop();
    h.advance(500);
    h.open();
    h.drop();
    expect(h.conn.state.retryAt).toBe(h.conn.state.retryAt);
    expect(backoffMs(0)).toBe(500);
  });

  test("a deliberate disconnect does not reconnect", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.conn.disconnect();
    h.advance(60_000);
    expect(h.openCount).toBe(1);
    expect(h.conn.state.connection).toBe("offline");
  });
});

describe("the queue survives a blip", () => {
  test("the selection is replayed on reconnect", () => {
    // Queue entries die with the socket -- there is no grace window. Replaying
    // is what makes a blip cost a position rather than the whole queue, and it
    // is why the grace window was removable.
    const h = harness();
    h.conn.connect();
    h.open();
    h.conn.join([AXI, MESO]);
    h.sent.length = 0;

    h.drop();
    h.advance(500);
    h.open();

    expect(h.parsed()).toEqual([{ type: "queue.join", selection: [AXI, MESO] }]);
  });

  test("an unqueued client replays nothing", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.drop();
    h.advance(500);
    h.open();
    expect(h.sent).toEqual([]);
  });

  test("leaving clears what would be replayed", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.conn.join([AXI]);
    h.conn.leave();
    h.sent.length = 0;

    h.drop();
    h.advance(500);
    h.open();
    expect(h.sent).toEqual([]);
  });

  test("a join always carries the FULL selection, never a diff", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.conn.join([AXI]);
    h.conn.join([AXI, MESO]);
    expect(h.parsed().at(-1)).toEqual({ type: "queue.join", selection: [AXI, MESO] });
  });
});

describe("the ready gate", () => {
  function gated() {
    const h = harness();
    h.conn.connect();
    h.open();
    h.recv({
      type: "ready.check",
      gateId: "g1",
      bucketKey: AXI,
      members: [
        { accountId: "a", confirmed: false },
        { accountId: "b", confirmed: false },
        { accountId: "c", confirmed: false },
        { accountId: "d", confirmed: false },
      ],
      deadlineAt: 61_000,
    });
    return h;
  }

  test("a check opens with a deadline and nobody confirmed", () => {
    const h = gated();
    expect(h.conn.state.gate!.deadlineAt).toBe(61_000);
    expect(h.conn.state.gate!.members.every((m) => !m.confirmed)).toBe(true);
    expect(h.conn.state.gate!.confirmed).toBe(false);
  });

  test("confirming locks the button optimistically", () => {
    const h = gated();
    h.conn.confirmReady();
    expect(h.conn.state.gate!.confirmed).toBe(true);
    expect(h.parsed().at(-1)).toEqual({ type: "ready.confirm", gateId: "g1" });
  });

  test("a second press sends nothing", () => {
    const h = gated();
    h.conn.confirmReady();
    h.sent.length = 0;
    h.conn.confirmReady();
    expect(h.sent).toEqual([]);
  });

  test("state updates show who else is in", () => {
    const h = gated();
    h.recv({
      type: "ready.state",
      gateId: "g1",
      members: [
        { accountId: "a", confirmed: true },
        { accountId: "b", confirmed: true },
        { accountId: "c", confirmed: false },
        { accountId: "d", confirmed: false },
      ],
    });
    expect(h.conn.state.gate!.members.filter((m) => m.confirmed)).toHaveLength(2);
  });

  test("a stale gate id is ignored", () => {
    const h = gated();
    h.recv({ type: "ready.state", gateId: "other", members: [] });
    expect(h.conn.state.gate!.members).toHaveLength(4);
  });

  test("a failure keeps the selection so re-queueing is one click", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.conn.join([AXI, MESO]);
    h.recv({ type: "ready.failed", gateId: "g1", reason: "you-did-not-confirm" });

    expect(h.conn.state.gate).toBeNull();
    expect(h.conn.state.gateFailure).toBe("you-did-not-confirm");

    h.sent.length = 0;
    h.conn.requeue();
    expect(h.parsed()).toEqual([{ type: "queue.join", selection: [AXI, MESO] }]);
  });

  test("each side of a failure gets its own reason", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.recv({ type: "ready.failed", gateId: "g1", reason: "someone-did-not-confirm" });
    expect(h.conn.state.gateFailure).toBe("someone-did-not-confirm");
  });

  test("a match clears the gate", () => {
    const h = gated();
    h.recv({ type: "match.found", lobbyId: "lob1" });
    expect(h.conn.state.gate).toBeNull();
  });
});

describe("the lobby", () => {
  const lobby = {
    lobbyId: "lob1",
    shareCode: "K7M2QP",
    bucketKey: AXI,
    relicName: "Axi A2",
    refinement: "radiant" as const,
    role: "member" as const,
    hostAccountId: "a",
    hostIgn: "zylok",
    members: [],
    whisperFormat: "/w <name> radshare Axi A2 Radiant",
    createdAt: 1000,
    expiresAt: 9000,
    closedAt: null,
  };

  test("arriving replaces the gate", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.recv({ type: "lobby.state", lobby });
    expect(h.conn.state.lobby!.lobbyId).toBe("lob1");
    expect(h.conn.state.gate).toBeNull();
  });

  test("closing clears it", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.recv({ type: "lobby.state", lobby });
    h.recv({ type: "lobby.closed", lobbyId: "lob1" });
    expect(h.conn.state.lobby).toBeNull();
  });

  test("leaving names the lobby it is leaving", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.recv({ type: "lobby.state", lobby });
    h.sent.length = 0;
    h.conn.leaveLobby();
    expect(h.parsed()).toEqual([{ type: "lobby.leave", lobbyId: "lob1" }]);
  });
});

describe("errors", () => {
  test("are surfaced by code, never swallowed", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.recv({ type: "error", code: "QUEUE_CAP_EXCEEDED" });
    expect(h.conn.state.error).toBe("QUEUE_CAP_EXCEEDED");
  });

  test("a new action clears the previous one", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    h.recv({ type: "error", code: "QUEUE_CAP_EXCEEDED" });
    h.conn.join([AXI]);
    expect(h.conn.state.error).toBeNull();
  });

  test("a malformed frame is ignored rather than crashing the client", () => {
    const h = harness();
    h.conn.connect();
    h.open();
    expect(() => h.recv("not json" as never)).not.toThrow();
  });
});

describe("relic labels", () => {
  test("fall back to the id rather than a placeholder", () => {
    expect(labelFor(AXI)).toEqual({ relicId: "Axi A2", name: "Axi A2", refinement: "radiant" });
  });

  test("use the vendored name when there is one", () => {
    expect(labelFor(bucketKey("/Lotus/T4/Gauss", "intact"), { "/Lotus/T4/Gauss": "Axi G9" }).name).toBe(
      "Axi G9",
    );
  });

  test("a lone queuer is told they are early, not shown a bare number", () => {
    expect(waitingCopy(1, "Axi G9")).toBe("You're first in line for Axi G9.");
    expect(waitingCopy(3, "Axi G9")).toContain("One more");
    expect(waitingCopy(4, "Axi G9")).toBeNull();
  });
});
