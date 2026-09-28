/**
 * Presence: who is actually here, and when their queue entries go away.
 *
 * This is queue-side only. Lobbies are rows in SQLite and survive disconnection,
 * browser close and server restart — nothing here touches them.
 *
 * Clients are INDEPENDENT. An account may hold several sockets at once — a
 * desktop and a phone are two clients sharing an account and nothing else, and
 * neither disconnects the other. Eviction happens when the account's LAST socket
 * closes, never when any one of them does.
 *
 * Synchronous and time-injected. Connections are opaque string ids, never socket
 * objects, so disconnection is tested by calling a function rather than tearing
 * down a real connection.
 *
 * Verified against Bun 1.4.2 + Caddy 2.11.4 (T-spike):
 *   - do NOT configure a ping interval; set `idleTimeout` and Bun pings at half
 *     of it. There is no sweep and no `lastPongAt` bookkeeping to write.
 *   - a killed peer fires `close` in ~1ms, through the reverse proxy unchanged.
 *     Only a SILENT death — no FIN, so nothing tells the server — costs the full
 *     `idleTimeout`, and that is the only thing that window measures.
 */

import type { AccountId } from "@radshare/protocol";

/**
 * Seconds of silence before Bun gives up on a connection. Bun pings at half
 * this, so 30 means a ping roughly every 15s.
 *
 * This is the ONLY delay between someone vanishing and the board forgetting
 * them, and that is deliberate. An earlier design added a 60-second grace window
 * on top, so that a brief blip did not cost a queue position. It was removed:
 * there is no room scarcity — any four people match — so a lost position costs
 * only whoever joined that bucket in the meantime, usually nobody. Meanwhile the
 * client already re-queues from `localStorage` on reconnect, which exists for
 * deploys and covers a blip anyway. The grace duplicated that, added a map and a
 * sweep, and more than tripled the window in which a departed player could be
 * pulled into a ready check they could not confirm.
 */
export const IDLE_TIMEOUT_S = 30;

export type ConnectionId = string;

export type CloseOutcome =
  /** Other sockets for this account are still open. Nothing to do. */
  | { kind: "still-connected"; remaining: number }
  /** That was the last one. Take the account out of every bucket. */
  | { kind: "evict" };

export class Presence {
  #sockets = new Map<AccountId, Set<ConnectionId>>();

  /** `firstSocket` is true when this account had none open. */
  connect(accountId: AccountId, connectionId: ConnectionId): { firstSocket: boolean } {
    const set = this.#sockets.get(accountId) ?? new Set<ConnectionId>();
    const firstSocket = set.size === 0;
    set.add(connectionId);
    this.#sockets.set(accountId, set);
    return { firstSocket };
  }

  /**
   * A socket closed. Only the LAST one for an account causes eviction, and it
   * causes it immediately regardless of close code — a deliberate tab close and
   * a dead router are treated the same, because the board should not vouch for
   * someone who is not connected.
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
