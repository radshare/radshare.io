/**
 * The wire. Closed unions both ways, so a client `switch` that misses a case
 * fails the build rather than ignoring a frame.
 *
 * Only authenticated accounts hold sockets — anonymous visitors poll
 * `GET /api/board` — so nothing here has an unauthenticated shape.
 */

import type { BoardDelta, BoardSnapshot } from "./board.ts";
import type { ErrorMessage } from "./errors.ts";
import type {
  LobbyClosedMessage,
  LobbyId,
  LobbyMemberChangedMessage,
  LobbyRejoinMessage,
  LobbyStateMessage,
  ShareCode,
} from "./lobby.ts";
import type { BucketKey } from "./queue.ts";
import type {
  ReadyCheckMessage,
  ReadyConfirmMessage,
  ReadyFailedMessage,
  ReadyStateMessage,
} from "./ready.ts";

/**
 * An idempotent SET: the full selection, never a diff. Unchanged buckets keep
 * their `enqueuedAt`, so toggling a relic cannot game the tiebreak.
 */
export type QueueJoinMessage = {
  type: "queue.join";
  selection: BucketKey[];
};

/** Clears everything. */
export type QueueLeaveMessage = {
  type: "queue.leave";
};

export type LobbyJoinByCodeMessage = {
  type: "lobby.join_by_code";
  code: ShareCode;
};

export type LobbyLeaveMessage = {
  type: "lobby.leave";
  lobbyId: LobbyId;
};

export type ClientMessage =
  | QueueJoinMessage
  | QueueLeaveMessage
  | ReadyConfirmMessage
  | LobbyRejoinMessage
  | LobbyJoinByCodeMessage
  | LobbyLeaveMessage;

/** Same pass as the fire, so an instant match never renders a personal board. */
export type MatchFoundMessage = {
  type: "match.found";
  lobbyId: LobbyId;
};

export type ServerMessage =
  | BoardSnapshot
  | BoardDelta
  | ReadyCheckMessage
  | ReadyStateMessage
  | ReadyFailedMessage
  | MatchFoundMessage
  | LobbyStateMessage
  | LobbyMemberChangedMessage
  | LobbyClosedMessage
  | ErrorMessage;

export type ClientMessageType = ClientMessage["type"];

const CLIENT_TYPES: ReadonlySet<string> = new Set<ClientMessageType>([
  "queue.join",
  "queue.leave",
  "ready.confirm",
  "lobby.rejoin",
  "lobby.join_by_code",
  "lobby.leave",
]);

/**
 * Null rather than a throw on anything malformed. A socket is a public surface
 * even when authenticated, so every field is checked before it reaches the
 * matcher.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;

  const msg = data as Record<string, unknown>;
  if (typeof msg.type !== "string" || !CLIENT_TYPES.has(msg.type)) return null;

  switch (msg.type) {
    case "queue.join": {
      if (!Array.isArray(msg.selection)) return null;
      if (!msg.selection.every((k) => typeof k === "string" && k.length > 0)) return null;
      return { type: "queue.join", selection: msg.selection as BucketKey[] };
    }
    case "queue.leave":
      return { type: "queue.leave" };
    case "ready.confirm": {
      if (typeof msg.gateId !== "string") return null;
      return { type: "ready.confirm", gateId: msg.gateId };
    }
    case "lobby.rejoin":
      return { type: "lobby.rejoin" };
    case "lobby.join_by_code": {
      if (typeof msg.code !== "string") return null;
      return { type: "lobby.join_by_code", code: msg.code };
    }
    case "lobby.leave": {
      if (typeof msg.lobbyId !== "string") return null;
      return { type: "lobby.leave", lobbyId: msg.lobbyId };
    }
    default:
      return null;
  }
}
