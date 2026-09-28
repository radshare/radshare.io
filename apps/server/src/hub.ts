/**
 * The hub: where the queue, the ready gate, the lobby and the board meet.
 *
 * Everything below this file is pure or synchronous and testable on its own.
 * This is the one place they are wired together, so it is the one place an
 * ordering mistake can strand a bucket — which is why it takes its clock and
 * its outbound sink as parameters and never touches a socket object.
 *
 * THE MATCH PASS IS SYNCHRONOUS AND CONTAINS ZERO `await`s. `planMatch`
 * evicts, snapshots and computes deltas in one go; the gate opens from its
 * result; only then does anything broadcast. `bun:sqlite` is synchronous too,
 * so even the lobby insert does not yield. Introducing an `await` between the
 * eviction and the gate is what leaves a bucket sitting at 4/4 forever.
 *
 * Connections are opaque string ids. An account may hold several — a desktop
 * and a phone are two clients sharing an account and nothing else — and is
 * evicted from its buckets only when the LAST one closes.
 */

import type { Database } from "bun:sqlite";
import {
  errorCopy,
  parseBucketKey,
  REFINEMENTS,
  type AccountId,
  type BucketKey,
  type Buckets,
  type ClientMessage,
  type ErrorCode,
  type Refinement,
  type ServerMessage,
} from "@radshare/protocol";
import { BoardCache, BoardStream } from "./board.ts";
import { recordEvent } from "./db.ts";
import { Lobbies, type RelicNames } from "./lobby.ts";
import { planLeave, planMatch, planRestore, type Plan } from "./matcher.ts";
import { Presence, type ConnectionId } from "./presence.ts";
import { ReadyGates, type GateFailure } from "./readygate.ts";

export type Outbound = (connectionId: ConnectionId, message: ServerMessage) => void;

export type HubOptions = {
  db: Database;
  relicName: RelicNames;
  send: Outbound;
  now?: () => number;
  /** Non-null only when the relic list is loaded; unknown ids are rejected. */
  knownRelic?: (relicId: string) => boolean;
};

type Connection = {
  connectionId: ConnectionId;
  accountId: AccountId;
  stream: BoardStream;
};

export class Hub {
  readonly buckets: Buckets = new Map();
  readonly presence = new Presence();
  readonly gates = new ReadyGates();
  readonly lobbies: Lobbies;
  readonly cache = new BoardCache();

  #connections = new Map<ConnectionId, Connection>();
  #byAccount = new Map<AccountId, Set<ConnectionId>>();
  #db: Database;
  #send: Outbound;
  #now: () => number;
  #knownRelic: (relicId: string) => boolean;

  constructor(opts: HubOptions) {
    this.#db = opts.db;
    this.#send = opts.send;
    this.#now = opts.now ?? Date.now;
    this.#knownRelic = opts.knownRelic ?? (() => true);
    this.lobbies = new Lobbies(opts.db, opts.relicName);
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  open(connectionId: ConnectionId, accountId: AccountId): void {
    const stream = new BoardStream(accountId);
    this.#connections.set(connectionId, { connectionId, accountId, stream });

    const held = this.#byAccount.get(accountId) ?? new Set<ConnectionId>();
    held.add(connectionId);
    this.#byAccount.set(accountId, held);
    this.presence.connect(accountId, connectionId);

    // The snapshot picks its own mode from the buckets, so a second device or a
    // refresh lands in personal mode without the client claiming anything —
    // and without re-sending `queue.join`, which would reset `enqueuedAt`.
    this.#send(connectionId, stream.snapshot(this.buckets, this.#now()));

    const lobbyId = this.lobbies.openLobbyFor(accountId, this.#now());
    if (lobbyId) this.#sendLobby(connectionId, lobbyId, accountId);
  }

  /**
   * ANY close evicts once it is the account's last socket. There is no grace
   * window and no close-code branch: the board must not vouch for someone who
   * is not connected, and a blip is already covered by the client re-queueing
   * on reconnect.
   */
  close(connectionId: ConnectionId): void {
    const conn = this.#connections.get(connectionId);
    if (!conn) return;
    this.#connections.delete(connectionId);

    const held = this.#byAccount.get(conn.accountId);
    held?.delete(connectionId);
    if (held && held.size === 0) this.#byAccount.delete(conn.accountId);

    if (this.presence.disconnect(conn.accountId, connectionId).kind !== "evict") return;

    // A member vanishing mid-gate fails it now rather than burning the
    // countdown: they cannot confirm, so the other three are only waiting to
    // be told.
    const failure = this.gates.abandon(conn.accountId, this.#now());
    if (failure) this.#resolveFailure(failure);

    this.#broadcast(planLeave(this.buckets, conn.accountId));
  }

  // -------------------------------------------------------------------------
  // messages
  // -------------------------------------------------------------------------

  handle(connectionId: ConnectionId, msg: ClientMessage): void {
    const conn = this.#connections.get(connectionId);
    if (!conn) return;

    switch (msg.type) {
      case "queue.join":
        return this.#join(conn, msg.selection);
      case "queue.leave":
        return this.#broadcast(planLeave(this.buckets, conn.accountId));
      case "ready.confirm":
        return this.#confirm(conn, msg.gateId);
      case "lobby.rejoin": {
        const lobbyId = this.lobbies.openLobbyFor(conn.accountId, this.#now());
        if (lobbyId) this.#sendLobby(connectionId, lobbyId, conn.accountId);
        else this.#error(connectionId, "LOBBY_CLOSED");
        return;
      }
      case "lobby.leave": {
        const { dissolved } = this.lobbies.leave(msg.lobbyId, conn.accountId, this.#now());
        if (dissolved) this.#notifyLobby(msg.lobbyId, { type: "lobby.closed", lobbyId: msg.lobbyId });
        else this.#refreshLobby(msg.lobbyId);
        return;
      }
      case "lobby.join_by_code":
        // Group formation is deferred (T13) and needs a matcher change, not a
        // route. Saying so is better than a route that half works.
        return this.#error(connectionId, "CODE_NOT_FOUND");
    }
  }

  #join(conn: Connection, selection: BucketKey[]): void {
    for (const key of selection) {
      if (!this.#validBucketKey(key)) return this.#error(conn.connectionId, "MATCH_FAILED");
    }

    // Checked HERE rather than at match time. An account with no row has no
    // in-game name, so the host could never invite them — and discovering that
    // when the lobby is written would fail a match that three other people had
    // already confirmed. The cost belongs on the one person who has not
    // finished signing up.
    if (selection.length > 0 && !this.#hasAccount(conn.accountId)) {
      return this.#error(conn.connectionId, "IGN_REQUIRED");
    }

    const result = planMatch(this.buckets, { accountId: conn.accountId, selection }, this.#now());
    if (!result.ok) return this.#error(conn.connectionId, result.error);
    this.#broadcast(result.plan);
  }

  #confirm(conn: Connection, gateId: string): void {
    const outcome = this.gates.confirm(gateId, conn.accountId, this.#now());

    switch (outcome.kind) {
      case "unknown":
      case "not-a-member":
        return;
      case "pending":
        for (const member of outcome.gate.members) {
          this.#toAccount(member.accountId, {
            type: "ready.state",
            gateId,
            members: outcome.members,
          });
        }
        return;
      case "complete": {
        // All four are in. The lobby row is written and only then announced.
        //
        // If that write fails, everyone goes BACK — the gate is already closed
        // by this point, so without the restore four people are out of every
        // bucket they held with nothing to show for it. `evicted` was carried
        // through the gate for exactly this.
        let lobbyId: string;
        try {
          lobbyId = this.lobbies.create(outcome.gate, this.#now()).lobbyId;
        } catch {
          for (const member of outcome.gate.members) {
            this.#toAccount(member.accountId, { type: "error", code: "MATCH_FAILED" });
          }
          this.#broadcast(planRestore(this.buckets, outcome.gate.evicted));
          return;
        }

        for (const member of outcome.gate.members) {
          this.#toAccount(member.accountId, { type: "match.found", lobbyId });
          for (const connectionId of this.#connectionsOf(member.accountId)) {
            this.#sendLobby(connectionId, lobbyId, member.accountId);
          }
        }
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // the ready gate
  // -------------------------------------------------------------------------

  /** Drive from a timer. Sweeps every gate whose 60 seconds have run out. */
  expireGates(): void {
    for (const failure of this.gates.expire(this.#now())) this.#resolveFailure(failure);
  }

  /** Drive from a timer. Dissolves lobbies past their two-hour ceiling. */
  expireLobbies(): void {
    for (const lobbyId of this.lobbies.expire(this.#now())) {
      this.#notifyLobby(lobbyId, { type: "lobby.closed", lobbyId });
    }
  }

  /**
   * Both audiences are told, and neither is ever silently dropped.
   *
   * Confirmers go back to their buckets with their ORIGINAL `enqueuedAt` — they
   * did nothing wrong. Non-confirmers are out of every bucket they held, not
   * just the one that popped, because someone who missed a 60-second countdown
   * carrying a gong and a title flip is not at their machine, and leaving them
   * queued means the next three people hit the same dead end.
   */
  #resolveFailure(failure: GateFailure): void {
    recordEvent(
      this.#db,
      "ready_gate_failed",
      {
        bucketKey: failure.gate.bucketKey,
        confirmed: failure.confirmers.length,
        size: failure.gate.members.length,
      },
      this.#now(),
    );

    for (const accountId of [...failure.confirmers, ...failure.nonConfirmers]) {
      this.#toAccount(accountId, {
        type: "ready.failed",
        gateId: failure.gate.gateId,
        reason: failure.reason(accountId),
      });
    }

    // Restoring can itself complete a bucket, and that is correct: those are
    // four real people waiting on the same relic.
    this.#broadcast(planRestore(this.buckets, failure.restore));
  }

  // -------------------------------------------------------------------------
  // broadcast
  // -------------------------------------------------------------------------

  /**
   * Every connected client is re-projected after a change.
   *
   * Each stream recomputes its own board rather than receiving a shared delta,
   * because the two modes see different things and a bucket leaving the global
   * top 60 is not a change anyone "touched". Coalescing these into one flush
   * per 100ms tick is T3d; the shapes here already carry an array, so that is a
   * scheduling change rather than a protocol one.
   */
  #broadcast(plan: Plan): void {
    if (plan.readyCheck) {
      const gate = this.gates.open(plan.readyCheck, plan.evicted, this.#now());
      const members = gate.members.map((m) => ({ accountId: m.accountId, confirmed: false }));
      for (const member of gate.members) {
        this.#toAccount(member.accountId, {
          type: "ready.check",
          gateId: gate.gateId,
          bucketKey: gate.bucketKey,
          members,
          deadlineAt: gate.deadlineAt,
        });
      }
    }

    if (plan.deltas.length === 0 && !plan.readyCheck) return;
    const now = this.#now();
    for (const conn of this.#connections.values()) {
      this.#send(conn.connectionId, conn.stream.update(this.buckets, now));
    }
  }

  #sendLobby(connectionId: ConnectionId, lobbyId: string, accountId: AccountId): void {
    const lobby = this.lobbies.viewFor(lobbyId, accountId);
    if (lobby) this.#send(connectionId, { type: "lobby.state", lobby });
  }

  /** Re-sends the lobby to every member, each getting their own role's view. */
  #refreshLobby(lobbyId: string): void {
    for (const conn of this.#connections.values()) {
      const lobby = this.lobbies.viewFor(lobbyId, conn.accountId);
      if (lobby?.members.some((m) => m.accountId === conn.accountId)) {
        this.#send(conn.connectionId, { type: "lobby.state", lobby });
      }
    }
  }

  #notifyLobby(lobbyId: string, message: ServerMessage): void {
    for (const conn of this.#connections.values()) {
      const lobby = this.lobbies.viewFor(lobbyId, conn.accountId);
      if (lobby?.members.some((m) => m.accountId === conn.accountId)) {
        this.#send(conn.connectionId, message);
      }
    }
  }

  #toAccount(accountId: AccountId, message: ServerMessage): void {
    for (const connectionId of this.#connectionsOf(accountId)) {
      this.#send(connectionId, message);
    }
  }

  #connectionsOf(accountId: AccountId): ConnectionId[] {
    return [...(this.#byAccount.get(accountId) ?? [])];
  }

  #error(connectionId: ConnectionId, code: ErrorCode): void {
    this.#send(connectionId, { type: "error", code });
  }

  /**
   * A bucket key arrives from a client, so it is checked before it can create a
   * bucket. Without this, a socket can populate the board with keys that
   * resolve to no relic and no refinement — rows nobody can ever join.
   */
  #validBucketKey(key: BucketKey): boolean {
    const i = key.lastIndexOf(":");
    if (i <= 0) return false;
    const { relicId, refinement } = parseBucketKey(key);
    if (!REFINEMENTS.includes(refinement as Refinement)) return false;
    return this.#knownRelic(relicId);
  }

  /** An account row exists only once a name has been set. */
  #hasAccount(accountId: AccountId): boolean {
    return (
      this.#db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM accounts WHERE account_id = ?")
        .get(accountId)!.n > 0
    );
  }

  hasAccount(accountId: AccountId): boolean {
    return this.#hasAccount(accountId);
  }

  get db(): Database {
    return this.#db;
  }

  /** For the HTTP board route. Anonymous readers share one cached projection. */
  cachedBoard() {
    return this.cache.get(this.buckets, this.#now());
  }

  /** Distinct accounts holding at least one entry. Not sockets, not browsers. */
  playersQueued(): number {
    const accounts = new Set<AccountId>();
    for (const bucket of this.buckets.values()) {
      for (const entry of bucket) accounts.add(entry.accountId);
    }
    return accounts.size;
  }

  get connectionCount(): number {
    return this.#connections.size;
  }
}

export { errorCopy };
