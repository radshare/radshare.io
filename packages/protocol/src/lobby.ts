/**
 * The lobby: post-match, durable, asymmetric. A LOBBY is post-match, a BUCKET
 * is pre-match, and they never share a word.
 *
 * One job: get the HOST to whisper three people. Four people each whispering
 * three others is twelve whispers and colliding invites — so `whisper` exists
 * only on the host's copy, and a non-host literally cannot render the button.
 *
 * No readiness here; everyone on this screen passed the gate.
 */

import type { AccountId, BucketKey, Refinement } from "./queue.ts";

/** Two hours from creation, or all members gone — whichever is first. */
export const LOBBY_TTL_MS = 2 * 60 * 60 * 1000;

/** Length of a share code. Six characters over a 32-symbol alphabet. */
export const SHARE_CODE_LENGTH = 6;

/** Minus I, L, O and U — the characters people mistype off a screen. 32^6 ≈ 1.07bn. */
export const SHARE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Display only. Crossplay is on, so platform is never part of a bucket key. */
export const PLATFORMS = ["pc", "xbox", "playstation", "switch", "mobile"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type LobbyId = string;
export type ShareCode = string;

export type LobbyRole = "host" | "member";

export type LobbyMemberView = {
  accountId: AccountId;
  /** Self-declared and unverified, but REQUIRED — never blank, never absent. */
  ign: string;
  platform: Platform | null;
  /** Self-declared courtesy signal, never a gate. Null when unset. */
  masteryRank: number | null;
  isHost: boolean;
  isYou: boolean;
  /** The row stays visible, so the host still knows who was already whispered. */
  hasLeft: boolean;
  /**
   * Present ONLY on the host's view of the other three rows. The asymmetry is
   * the shape of the data, not a flag the client must remember to check.
   */
  whisper?: string;
};

export type LobbyView = {
  lobbyId: LobbyId;
  shareCode: ShareCode;
  bucketKey: BucketKey;
  /** Resolved from the vendored WFCD data by the caller, e.g. "Axi G9". */
  relicName: string;
  refinement: Refinement;
  role: LobbyRole;
  hostAccountId: AccountId;
  /** The name to wait on. Null ONLY on the host's own view — they are the host. */
  hostIgn: string | null;
  /** All four, in slot order, including anyone who left. */
  members: LobbyMemberView[];
  /** The reference line under the list, shown at every width. */
  whisperFormat: string;
  createdAt: number;
  expiresAt: number;
  /** Non-null once dissolved. */
  closedAt: number | null;
};

/** Longest name this accepts. Generous — the point is to reject blank, not to police. */
export const IGN_MAX_LENGTH = 24;

/**
 * Required and never blank — but unverified. DE exposes no player API, so this
 * checks shape only.
 */
export function normalizeIgn(raw: string): string | null {
  const ign = raw.trim();
  if (ign.length === 0 || ign.length > IGN_MAX_LENGTH) return null;
  return ign;
}

/** Warframe IGNs are plain — there is no `#1234` discriminator. */
export function buildWhisper(ign: string, relicName: string, refinement: Refinement): string {
  return `/w ${ign} radshare ${relicName} ${titleCase(refinement)}`;
}

/** The format line shown beneath the member list as a reference. */
export function whisperFormat(relicName: string, refinement: Refinement): string {
  return buildWhisper("<name>", relicName, refinement);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- wire -----------------------------------------------------------------

/** server -> client, on match and on reconnect. */
export type LobbyStateMessage = {
  type: "lobby.state";
  lobby: LobbyView;
};

/** server -> client, when a member leaves. */
export type LobbyMemberChangedMessage = {
  type: "lobby.member_changed";
  lobbyId: LobbyId;
  member: LobbyMemberView;
};

/** server -> client, on dissolution. */
export type LobbyClosedMessage = {
  type: "lobby.closed";
  lobbyId: LobbyId;
};

/** client -> server. Resolved from the account, not from a token. */
export type LobbyRejoinMessage = {
  type: "lobby.rejoin";
};
