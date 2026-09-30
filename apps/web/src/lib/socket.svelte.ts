/** Runes over `Connection`. Every decision lives there; this is the shell. */

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

  /** No-op on the server, so SSR renders the fetched board. */
  start(url = "/ws"): void {
    if (!browser || this.#conn) return;
    const absolute = new URL(url, location.href);
    absolute.protocol = absolute.protocol === "https:" ? "wss:" : "ws:";

    this.#conn = new Connection({
      transport: webSocketTransport(absolute.toString()),
      // A refresh closes the socket and evicts from every bucket; without this
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
