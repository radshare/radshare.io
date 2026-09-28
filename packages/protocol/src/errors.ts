/**
 * Every failure the user can see, named once.
 *
 * The wire carries `code` alone. Copy is looked up here, never sent, so a
 * wording change is a one-line edit that cannot desynchronise the two ends.
 * The server can only emit a listed code; a client `switch` over ErrorCode must
 * be exhaustive or the build fails.
 */

export const ERROR_COPY = {
  QUEUE_CAP_EXCEEDED: "You can queue for up to 20 relic and refinement pairs. Remove one to add another.",
  CODE_NOT_FOUND: "No squad with that code.",
  LOBBY_FULL: "This squad is already full.",
  LOBBY_CLOSED: "This lobby has closed.",
  MATCH_FAILED: "That match couldn't be created. You're still in the queue, in the same place.",
  READY_GATE_FAILED: "You didn't confirm in time, so you've been removed from the queue.",
  RATE_LIMITED: "Too many requests. Slow down for a moment.",
  CHAT_SEND_FAILED: "That message didn't send.",
  AUTH_FAILED: "Sign-in didn't complete. Try again.",
  IGN_REQUIRED: "Enter your in-game name. The host needs it to invite you.",
} as const satisfies Record<string, string>;

export type ErrorCode = keyof typeof ERROR_COPY;

export function errorCopy(code: ErrorCode): string {
  return ERROR_COPY[code];
}

export type ErrorMessage = {
  type: "error";
  code: ErrorCode;
};
