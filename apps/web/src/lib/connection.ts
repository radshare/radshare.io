/**
 * The socket client, minus the reactivity. Transport and timers are injected,
 * so backoff, replay and the disowning of stale counts are tested by calling
 * functions rather than pulling a network cable.
 *
 * Anonymous visitors poll the cached board and never reach this file.
 */

import {
  parseBucketKey,
  type BucketKey,
  type ClientMessage,
  type ErrorCode,
  type GateId,
  type LobbyView,
  type ReadyCheckMessage,
  type ReadyFailedReason,
  type ReadyMemberView,
  type ServerMessage,
} from "@radshare/protocol";
import {
  applyDelta,
  applySnapshot,
  backoffMs,
  EMPTY_BOARD,
  type BoardState,
  type ConnectionState,
} from "./boardState.ts";

export type Transport = {
  send(data: string): void;
  close(): void;
};

export type TransportFactory = (handlers: {
  onOpen: () => void;
  onMessage: (data: string) => void;
  onClose: () => void;
}) => Transport;

export type ReadyGateState = {
  gateId: GateId;
  bucketKey: BucketKey;
  members: ReadyMemberView[];
  deadlineAt: number;
  /** Locks the button. */
  confirmed: boolean;
};

export type ClientState = {
  connection: ConnectionState;
  board: BoardState;
  gate: ReadyGateState | null;
  lobby: LobbyView | null;
  /** Cleared on the next action. */
  gateFailure: ReadyFailedReason | null;
  error: ErrorCode | null;
  /** For the countdown in the connection bar. */
  retryAt: number | null;
};

export const INITIAL_STATE: ClientState = {
  connection: "connecting",
  board: EMPTY_BOARD,
  gate: null,
  lobby: null,
  gateFailure: null,
  error: null,
  retryAt: null,
};

/** Injected so tests need no browser. */
export type SelectionStore = {
  read(): BucketKey[] | null;
  write(selection: BucketKey[] | null): void;
};

export const SELECTION_KEY = "radshare.selection";

export function localSelectionStore(): SelectionStore {
  return {
    read() {
      try {
        const raw = localStorage.getItem(SELECTION_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.filter((k): k is BucketKey => typeof k === "string" && k.length > 0);
      } catch {
        return null;
      }
    },
    write(selection) {
      try {
        if (selection === null || selection.length === 0) localStorage.removeItem(SELECTION_KEY);
        else localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
      } catch {
        // Private mode. Not fatal.
      }
    },
  };
}

export type ConnectionOptions = {
  transport: TransportFactory;
  onChange: (state: ClientState) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
  storage?: SelectionStore;
};

export class Connection {
  #state: ClientState = { ...INITIAL_STATE };
  #transport: Transport | null = null;
  #attempt = 0;
  #retryHandle: number | null = null;
  #closed = false;

  /**
   * Replayed on reconnect. Queue entries die with the socket and there is no
   * grace window, so this is what makes a blip cost a position rather than the
   * whole queue — and what made the grace window redundant.
   */
  #selection: BucketKey[] = [];

  #storage: SelectionStore | null;

  #opts: Required<Omit<ConnectionOptions, "transport" | "onChange" | "storage">> &
    Pick<ConnectionOptions, "transport" | "onChange">;

  constructor(opts: ConnectionOptions) {
    this.#opts = {
      now: opts.now ?? Date.now,
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number),
      clearTimer: opts.clearTimer ?? ((h) => clearTimeout(h)),
      transport: opts.transport,
      onChange: opts.onChange,
    };
    this.#storage = opts.storage ?? null;
    // Guarded at the CALL SITE, not just inside the default store. Some
    // browsers throw on touching `localStorage` at all when cookies are
    // blocked, and a client that cannot construct is a blank page.
    this.#selection = this.#readStored();
  }

  get state(): ClientState {
    return this.#state;
  }

  connect(): void {
    this.#closed = false;
    this.#patch({ connection: this.#attempt === 0 ? "connecting" : "reconnecting", retryAt: null });
    this.#transport = this.#opts.transport({
      onOpen: () => this.#onOpen(),
      onMessage: (data) => this.#onMessage(data),
      onClose: () => this.#onClose(),
    });
  }

  /** No reconnect, no backoff. */
  disconnect(): void {
    this.#closed = true;
    if (this.#retryHandle !== null) this.#opts.clearTimer(this.#retryHandle);
    this.#retryHandle = null;
    this.#transport?.close();
    this.#transport = null;
    this.#patch({ connection: "offline", retryAt: null });
  }

  // -------------------------------------------------------------------------
  // actions
  // -------------------------------------------------------------------------

  /** The FULL selection — the server treats it as a set. */
  join(selection: BucketKey[]): void {
    this.#selection = [...selection];
    this.#writeStored(this.#selection);
    this.#patch({ error: null, gateFailure: null });
    this.#send({ type: "queue.join", selection: this.#selection });
  }

  /** Leaving is a DECISION: without clearing storage a refresh would undo it. */
  leave(): void {
    this.#selection = [];
    this.#writeStored(null);
    this.#patch({ error: null, gateFailure: null });
    this.#send({ type: "queue.leave" });
  }

  confirmReady(): void {
    const gate = this.#state.gate;
    if (!gate || gate.confirmed) return;
    // Optimistic, so the button cannot invite a second press in flight.
    this.#patch({ gate: { ...gate, confirmed: true } });
    this.#send({ type: "ready.confirm", gateId: gate.gateId });
  }

  rejoinLobby(): void {
    this.#send({ type: "lobby.rejoin" });
  }

  leaveLobby(): void {
    const lobby = this.#state.lobby;
    if (!lobby) return;
    this.#send({ type: "lobby.leave", lobbyId: lobby.lobbyId });
  }

  #readStored(): BucketKey[] {
    try {
      return this.#storage?.read() ?? [];
    } catch {
      return []; // storage can throw on access alone when cookies are blocked
    }
  }

  #writeStored(selection: BucketKey[] | null): void {
    try {
      this.#storage?.write(selection);
    } catch {
      // Losing storage costs a position across a refresh; throwing costs the page.
    }
  }

  /** What the next connect would replay. */
  get selection(): BucketKey[] {
    return [...this.#selection];
  }

  /** One click back after a failed gate; the selection is still loaded. */
  requeue(): void {
    if (this.#selection.length > 0) this.join(this.#selection);
    else this.#patch({ gateFailure: null });
  }

  // -------------------------------------------------------------------------
  // transport events
  // -------------------------------------------------------------------------

  #onOpen(): void {
    this.#attempt = 0;
    this.#patch({ connection: "live", retryAt: null, error: null });

    // The server sends a snapshot and any open lobby unasked, so nothing is
    // requested. Re-sending the selection covers a dropped socket and a
    // refresh, which are the same event: both were evicted from every bucket.
    // The position resets either way -- the honest cost of presence.
    if (this.#selection.length > 0) this.#send({ type: "queue.join", selection: this.#selection });
  }

  #onClose(): void {
    this.#transport = null;
    if (this.#closed) return;

    const delay = backoffMs(this.#attempt);
    this.#attempt += 1;
    this.#patch({ connection: "reconnecting", retryAt: this.#opts.now() + delay });
    this.#retryHandle = this.#opts.setTimer(() => this.connect(), delay);
  }

  #onMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "board.snapshot":
        return this.#patch({ board: applySnapshot(msg) });
      case "board.delta":
        return this.#patch({ board: applyDelta(this.#state.board, msg, this.#opts.now()) });
      case "ready.check":
        return this.#patch({ gate: gateFrom(msg), gateFailure: null });
      case "ready.state": {
        const gate = this.#state.gate;
        if (!gate || gate.gateId !== msg.gateId) return;
        return this.#patch({ gate: { ...gate, members: msg.members } });
      }
      case "ready.failed":
        // The selection is KEPT: out of the queue, never out of their choices.
        return this.#patch({ gate: null, gateFailure: msg.reason });
      case "match.found":
        return this.#patch({ gate: null, gateFailure: null });
      case "lobby.state":
        return this.#patch({ lobby: msg.lobby, gate: null });
      case "lobby.member_changed":
        return;
      case "lobby.closed":
        return this.#patch({ lobby: null });
      case "error":
        return this.#patch({ error: msg.code });
    }
  }

  #send(msg: ClientMessage): void {
    this.#transport?.send(JSON.stringify(msg));
  }

  #patch(part: Partial<ClientState>): void {
    this.#state = { ...this.#state, ...part };
    this.#opts.onChange(this.#state);
  }
}

function gateFrom(msg: ReadyCheckMessage): ReadyGateState {
  return {
    gateId: msg.gateId,
    bucketKey: msg.bucketKey,
    members: msg.members,
    deadlineAt: msg.deadlineAt,
    confirmed: false,
  };
}

/** The real browser transport. */
export function webSocketTransport(url: string): TransportFactory {
  return (handlers) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", handlers.onOpen);
    ws.addEventListener("message", (e) => handlers.onMessage(String(e.data)));
    ws.addEventListener("close", handlers.onClose);
    // An error is always followed by a close; handling it would double the timer.
    ws.addEventListener("error", () => {});
    return {
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      },
      close: () => ws.close(1000),
    };
  };
}

export { parseBucketKey };
