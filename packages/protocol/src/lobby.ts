/**
 * The lobby: post-match, durable, and deliberately asymmetric.
 *
 * A LOBBY is post-match. A BUCKET is pre-match. They never share a word.
 *
 * The one job of this screen is to get the HOST to whisper three people. Four
 * people each whispering three others is twelve whispers and colliding invites,
 * which is why the view is role-shaped rather than a member list with a badge:
 * the `whisper` string exists only on the host's copy and never for the host's
 * own row. A non-host cannot render a copy-whisper button because the data to
 * build one is not in their view.
 *
 * There is NO readiness here. A lobby exists only once all four passed the
 * ready gate, so everyone on this screen has already confirmed.
 */

import type { AccountId, BucketKey, Refinement } from "./queue.ts";

/** Two hours from creation, or all members gone — whichever is first. */
export const LOBBY_TTL_MS = 2 * 60 * 60 * 1000;

/** Length of a share code. Six characters over a 32-symbol alphabet. */
export const SHARE_CODE_LENGTH = 6;

/**
 * Digits and letters minus the four characters people mistype when reading a
 * code off a screen: I, L, O and U. 32^6 is about 1.07 billion.
 */
export const SHARE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Display only — crossplay is on by default, so platform is NEVER part of a
 * bucket key. It is here so a mismatch is visible before anyone whispers.
 */
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
  /**
   * Left explicitly. The row stays visible rather than disappearing, so the
   * host still knows who was already whispered.
   */
  hasLeft: boolean;
  /**
   * The ready-to-paste whisper for this member.
   *
   * Present ONLY on the host's view, and never on the host's own row. This is
   * the asymmetry, enforced by the shape of the data rather than by a flag the
   * client has to remember to check. It is never null: an account cannot exist
   * without an IGN, so a whisper can always be built for a real member.
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
 * An IGN is REQUIRED at account creation and can never be blank.
 *
 * It is still unverified: DE exposes no player API, so this checks shape and
 * nothing else. Required and verified are different things, and only the first
 * is claimed.
 */
export function normalizeIgn(raw: string): string | null {
  const ign = raw.trim();
  if (ign.length === 0 || ign.length > IGN_MAX_LENGTH) return null;
  return ign;
}

/**
 * The whisper the host pastes into Warframe.
 *
 * Warframe IGNs are plain — there is NO `#1234` discriminator. Earlier mockups
 * invented one; any mockup showing `zylok#314` is wrong.
 */
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

/** client -> server. Derived from the authenticated account, not from a token. */
export type LobbyRejoinMessage = {
  type: "lobby.rejoin";
};
