/**
 * The entry point. One Bun process, one box, by construction.
 *
 * Bun.serve terminates both the HTTP surface and the WebSocket on one origin.
 * Caddy sits in front for TLS, systemd restarts the process, SQLite is on the
 * local disk and litestream replicates it — there is no autoscaling to disable
 * and no rolling deploy that could fork the database.
 */

import { Database } from "bun:sqlite";
import { parseClientMessage } from "@radshare/protocol";
import { createApp } from "./app.ts";
import { buildAuthenticator, isDevAuth } from "./auth.ts";
import { openDatabase } from "./db.ts";
import { Hub } from "./hub.ts";
import { ConnectionCap, MessageLimiter } from "./limits.ts";
import { IDLE_TIMEOUT_S } from "./presence.ts";

/** Ticked from a timer because the gate's own clock is injected, never read. */
const SWEEP_INTERVAL_MS = 1_000;

type SocketData = {
  accountId: string;
  connectionId: string;
  ip: string | null;
};

export function start(env = process.env) {
  const db: Database = openDatabase(env.RADSHARE_DB ?? "radshare.sqlite");
  const cap = new ConnectionCap();
  const limiter = new MessageLimiter();

  // Relic display names come from the vendored WFCD build-time JSON. Until it
  // is generated the id is shown verbatim, which is ugly but never wrong.
  const relicName = (relicId: string) => relicId;

  const sockets = new Map<string, Bun.ServerWebSocket<SocketData>>();
  const hub = new Hub({
    db,
    relicName,
    send: (connectionId, message) => {
      sockets.get(connectionId)?.send(JSON.stringify(message));
    },
  });

  const app = createApp({
    hub,
    cap,
    authenticate: buildAuthenticator(env),
    devAuth: isDevAuth(env),
  });

  const server = Bun.serve({
    port: Number(env.PORT ?? 3000),
    hostname: env.HOST ?? "127.0.0.1",

    /**
     * No ping interval is configured, deliberately. Bun pings at HALF
     * `idleTimeout` — measured: an 8s timeout produced pongs at 4/8/12/16s —
     * so setting both would be redundant and contradictory. There is no sweep
     * and no `lastPongAt` bookkeeping: Bun evicts on timeout and fires `close`,
     * and bucket eviction happens there.
     */
    websocket: {
      idleTimeout: IDLE_TIMEOUT_S,

      open(ws: Bun.ServerWebSocket<SocketData>) {
        sockets.set(ws.data.connectionId, ws);
        hub.open(ws.data.connectionId, ws.data.accountId);
      },

      message(ws: Bun.ServerWebSocket<SocketData>, raw) {
        if (!limiter.allow(ws.data.connectionId, Date.now())) {
          // Dropped WITH an explicit code, never silently.
          ws.send(JSON.stringify({ type: "error", code: "RATE_LIMITED" }));
          return;
        }
        const msg = parseClientMessage(typeof raw === "string" ? raw : raw.toString());
        if (!msg) return;
        hub.handle(ws.data.connectionId, msg);
      },

      /**
       * Every close is treated the same. A deliberate tab close and a dead
       * router both evict, once this is the account's last socket — the board
       * must not vouch for someone who is not connected. Close codes remain
       * distinguishable (1000/1001 clean, 1006 abnormal, unchanged through
       * Caddy); the design simply no longer needs to branch on them.
       */
      close(ws: Bun.ServerWebSocket<SocketData>) {
        sockets.delete(ws.data.connectionId);
        limiter.forget(ws.data.connectionId);
        cap.release(ws.data.ip, ws.data.connectionId);
        hub.close(ws.data.connectionId);
      },
    },

    fetch(req, srv) {
      return app.fetch(req, {
        peer: srv.requestIP(req)?.address ?? null,
        upgrade: (data: SocketData) => srv.upgrade(req, { data }),
      });
    },
  });

  const sweep = setInterval(() => {
    hub.expireGates();
    hub.expireLobbies();
  }, SWEEP_INTERVAL_MS);

  return {
    server,
    hub,
    /**
     * Force-closes live sockets rather than waiting for them to drain.
     *
     * A WebSocket held open by someone watching the board will never drain on
     * its own, so a graceful stop would hang the deploy. Closing them is also
     * the kinder behaviour: queue entries die with the socket anyway, and a
     * client that sees a close reconnects in 500ms, where one left hanging on
     * a dead process sits there showing counts that stopped being true.
     */
    stop() {
      clearInterval(sweep);
      server.stop(true);
      db.close();
    },
  };
}

if (import.meta.main) {
  const { server } = start();
  const where = `http://${server.hostname}:${server.port}`;
  console.log(`radshare listening on ${where}`);
  if (isDevAuth(process.env)) {
    console.log(`dev auth ON — sign in at ${where}/api/dev-login?account=you&ign=zylok`);
  }
}
