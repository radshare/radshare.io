/**
 * Where the queue, the ready gate, the lobby and the board meet — the one place
 * an ordering mistake can strand a bucket, which is why the clock and the
 * outbound sink are parameters and no socket object is ever in scope.
 *
 * THE MATCH PASS CONTAINS ZERO `await`s. `planMatch` evicts, snapshots and
 * computes deltas in one go, the gate opens from its result, and only then does
 * anything broadcast. An `await` between the eviction and the gate is what
 * leaves a bucket at 4/4 forever.
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
  /** Unknown relic ids are rejected before they can create a bucket. */
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

    // The snapshot picks its own mode, so a second device lands in personal
    // mode without re-sending `queue.join` and resetting `enqueuedAt`.
    this.#send(connectionId, stream.snapshot(this.buckets, this.#now()));

    const lobbyId = this.lobbies.openLobbyFor(accountId, this.#now());
    if (lobbyId) this.#sendLobby(connectionId, lobbyId, accountId);
  }

  /**
   * Any close evicts once it is the account's LAST socket. No grace window and
   * no close-code branch — a blip is covered by the client's re-queue instead.
   */
  close(connectionId: ConnectionId): void {
    const conn = this.#connections.get(connectionId);
    if (!conn) return;
    this.#connections.delete(connectionId);

    const held = this.#byAccount.get(conn.accountId);
    held?.delete(connectionId);
    if (held && held.size === 0) this.#byAccount.delete(conn.accountId);

    if (this.presence.disconnect(conn.accountId, connectionId).kind !== "evict") return;

    // They cannot confirm, so the other three are only waiting to be told.
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
        // Deferred: group formation needs a matcher change, not a route.
        return this.#error(connectionId, "CODE_NOT_FOUND");
    }
  }

  #join(conn: Connection, selection: BucketKey[]): void {
    for (const key of selection) {
      if (!this.#validBucketKey(key)) return this.#error(conn.connectionId, "MATCH_FAILED");
    }

    // Checked HERE, not at match time: discovering it when the lobby is
    // written would fail a match three other people already confirmed.
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
        // Written first, announced second. If the write fails everyone goes
        // BACK: the gate is already closed, so without the restore four people
        // are out of every bucket with nothing to show for it.
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

  /** Driven by a timer. */
  expireGates(): void {
    for (const failure of this.gates.expire(this.#now())) this.#resolveFailure(failure);
  }

  /** Driven by a timer. */
  expireLobbies(): void {
    for (const lobbyId of this.lobbies.expire(this.#now())) {
      this.#notifyLobby(lobbyId, { type: "lobby.closed", lobbyId });
    }
  }

  /**
   * Both audiences are told; neither is silently dropped. Confirmers keep their
   * ORIGINAL `enqueuedAt`, non-confirmers leave every bucket they held.
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

    // A restore that completes a bucket fires it, which is correct.
    this.#broadcast(planRestore(this.buckets, failure.restore));
  }

  // -------------------------------------------------------------------------
  // broadcast
  // -------------------------------------------------------------------------

  /**
   * Each stream recomputes its own board rather than sharing one delta: the two
   * modes see different things, and a bucket leaving the top 60 is not a change
   * anyone touched. Coalescing into a 100ms tick is a scheduling change only.
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

  /** Each member gets their own role's view. */
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

  /** Without this a socket can fill the board with rows nobody can join. */
  #validBucketKey(key: BucketKey): boolean {
    const i = key.lastIndexOf(":");
    if (i <= 0) return false;
    const { relicId, refinement } = parseBucketKey(key);
    if (!REFINEMENTS.includes(refinement as Refinement)) return false;
    return this.#knownRelic(relicId);
  }

  /** An account exists only once a name has been set. */
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

  /** Anonymous readers share one cached projection. */
  cachedBoard() {
    return this.cache.get(this.buckets, this.#now());
  }

  /** Distinct ACCOUNTS holding an entry — not sockets, not browsers. */
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
