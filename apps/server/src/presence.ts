/**
 * Who is here, and when their queue entries go away. Queue-side only — lobbies
 * are SQLite rows and outlive every socket.
 *
 * Clients are INDEPENDENT: a desktop and a phone share an account and nothing
 * else, and eviction waits for the account's LAST socket.
 *
 * Verified on Bun 1.4.2 behind Caddy 2.11.4: do NOT configure a ping interval,
 * set `idleTimeout` and Bun pings at half of it. No sweep, no `lastPongAt`. A
 * killed peer fires `close` in ~1ms; only a silent death costs the full window.
 */

import type { AccountId } from "@radshare/protocol";

/**
 * Seconds of silence before Bun gives up. It pings at half this.
 *
 * The ONLY delay between vanishing and being forgotten. A 60s grace window was
 * cut during implementation: it duplicated the client's re-queue on reconnect,
 * and tripled the window in which a departed player could be pulled into a
 * ready check they could not confirm.
 */
export const IDLE_TIMEOUT_S = 30;

export type ConnectionId = string;

export type CloseOutcome =
  | { kind: "still-connected"; remaining: number }
  /** The last socket closed. Take the account out of every bucket. */
  | { kind: "evict" };

export class Presence {
  #sockets = new Map<AccountId, Set<ConnectionId>>();

  /** `firstSocket` is true when the account had none open. */
  connect(accountId: AccountId, connectionId: ConnectionId): { firstSocket: boolean } {
    const set = this.#sockets.get(accountId) ?? new Set<ConnectionId>();
    const firstSocket = set.size === 0;
    set.add(connectionId);
    this.#sockets.set(accountId, set);
    return { firstSocket };
  }

  /**
   * Only the LAST socket evicts, and it evicts immediately regardless of close
   * code: the board must not vouch for someone who is not connected.
   */
  disconnect(accountId: AccountId, connectionId: ConnectionId): CloseOutcome {
    const set = this.#sockets.get(accountId);
    if (!set) return { kind: "evict" };

    set.delete(connectionId);
    if (set.size > 0) return { kind: "still-connected", remaining: set.size };

    this.#sockets.delete(accountId);
    return { kind: "evict" };
  }

  isConnected(accountId: AccountId): boolean {
    return (this.#sockets.get(accountId)?.size ?? 0) > 0;
  }

  socketCount(accountId: AccountId): number {
    return this.#sockets.get(accountId)?.size ?? 0;
  }

  connectionsOf(accountId: AccountId): ConnectionId[] {
    return [...(this.#sockets.get(accountId) ?? [])];
  }
}
