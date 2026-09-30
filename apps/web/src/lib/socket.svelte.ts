/**
 * The reactive shell over `Connection`.
 *
 * Deliberately thin: every decision lives in `connection.ts`, which is tested
 * without a browser. This file exists only to turn a callback into runes.
 */

import { browser } from "$app/environment";
import {
  Connection,
  localSelectionStore,
  webSocketTransport,
  type ClientState,
} from "./connection.ts";
import { INITIAL_STATE } from "./connection.ts";

export class SocketStore {
  state = $state<ClientState>({ ...INITIAL_STATE });
  #conn: Connection | null = null;

  /** No-op outside the browser, so SSR renders the server-fetched board. */
  start(url = "/ws"): void {
    if (!browser || this.#conn) return;
    const absolute = new URL(url, location.href);
    absolute.protocol = absolute.protocol === "https:" ? "wss:" : "ws:";

    this.#conn = new Connection({
      transport: webSocketTransport(absolute.toString()),
      // A refresh closes the socket, which evicts the account from every
      // bucket. Without the stored selection the new page has no memory and
      // the user silently leaves a queue they never left.
      storage: localSelectionStore(),
      onChange: (next) => {
        this.state = next;
      },
    });
    this.#conn.connect();
  }

  stop(): void {
    this.#conn?.disconnect();
    this.#conn = null;
  }

  get connection(): Connection | null {
    return this.#conn;
  }
}

export const socket = new SocketStore();
