/**
 * The lobby layer: post-match, durable, asymmetric.
 *
 * Lobbies are rows in SQLite and survive disconnection, browser close and
 * server restart. That is the opposite of the queue, which is in-memory and
 * dies with the socket — and the difference is deliberate. A queue entry is a
 * claim about right now; a lobby is a record of something that happened.
 *
 * **The intended happy path is that you leave.** You read the names, alt-tab
 * into Warframe, and abandon the browser. Nothing in this file punishes that:
 * there is no heartbeat, no attendance, no timeout that marks you absent. The
 * only thing that removes you is pressing Leave.
 *
 * `bun:sqlite` is synchronous, so every function here is too.
 */

import type { Database } from "bun:sqlite";
import {
  LOBBY_TTL_MS,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_LENGTH,
  SQUAD_SIZE,
  buildWhisper,
  parseBucketKey,
  whisperFormat,
  type AccountId,
  type BucketKey,
  type LobbyId,
  type LobbyMemberView,
  type LobbyRole,
  type LobbyView,
  type Platform,
  type ShareCode,
} from "@radshare/protocol";
import { recordEvent } from "./db.ts";
import type { Gate } from "./readygate.ts";

/** Resolves a WFCD `uniqueName` to something a human can paste. Vendored data. */
export type RelicNames = (relicId: string) => string;

type LobbyRow = {
  lobby_id: string;
  share_code: string;
  bucket_key: string;
  host_account_id: string;
  created_at: number;
  expires_at: number;
  closed_at: number | null;
};

type MemberRow = {
  account_id: string;
  slot: number;
  enqueued_at: number;
  matched_at: number;
  left_at: number | null;
  ign: string | null;
  platform: string | null;
  mastery_rank: number | null;
};

export type CreateResult = { lobbyId: LobbyId; shareCode: ShareCode };

export class Lobbies {
  constructor(
    private readonly db: Database,
    private readonly relicName: RelicNames,
    private readonly newId: () => string = defaultId,
    private readonly newCode: () => ShareCode = defaultCode,
  ) {}

  /**
   * Turns a completed gate into a lobby.
   *
   * Called only after all four confirmed — this is the one path that creates a
   * lobby, which is what makes "everyone here already confirmed" true by
   * construction rather than by convention.
   *
   * Slots are assigned in the gate's FIFO order, so slot 0 is the longest
   * waiter and therefore the host. One transaction: a partial insert would
   * leave a lobby nobody can complete.
   */
  create(gate: Gate, now: number): CreateResult {
    const lobbyId = this.newId();
    const shareCode = this.uniqueCode();

    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO lobbies
             (lobby_id, share_code, bucket_key, host_account_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(lobbyId, shareCode, gate.bucketKey, gate.hostAccountId, now, now + LOBBY_TTL_MS);

      const insert = this.db.query(
        `INSERT INTO lobby_members
           (lobby_id, account_id, slot, enqueued_at, matched_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const [slot, member] of gate.members.entries()) {
        insert.run(lobbyId, member.accountId, slot, member.enqueuedAt, now);
      }
    })();

    recordEvent(
      this.db,
      "match_fired",
      { lobbyId, bucketKey: gate.bucketKey, waitedMs: gate.members.map((m) => now - m.enqueuedAt) },
      now,
    );

    return { lobbyId, shareCode };
  }

  /**
   * The asymmetric view. This is the whole point of the screen.
   *
   * The host's copy carries a ready-to-paste whisper on the OTHER three rows.
   * A member's copy carries none at all — not a disabled button, not an empty
   * string, the field is absent. Four people each whispering three others is
   * twelve whispers and colliding invites, and the cheapest way to prevent it
   * is to never send a non-host the data.
   *
   * `viewerAccountId` need not be a member: a lobby opened by share code is
   * read before anyone joins it. A non-member reads as a `member` role with no
   * `isYou` row, which is the correct shape for that screen.
   */
  viewFor(lobbyId: LobbyId, viewerAccountId: AccountId): LobbyView | null {
    const lobby = this.db
      .query<LobbyRow, [string]>("SELECT * FROM lobbies WHERE lobby_id = ?")
      .get(lobbyId);
    if (!lobby) return null;

    const rows = this.db
      .query<MemberRow, [string]>(
        `SELECT m.account_id, m.slot, m.enqueued_at, m.matched_at, m.left_at,
                a.ign, a.platform, a.mastery_rank
           FROM lobby_members m
           LEFT JOIN accounts a ON a.account_id = m.account_id
          WHERE m.lobby_id = ?
          ORDER BY m.slot`,
      )
      .all(lobbyId);

    const { relicId, refinement } = parseBucketKey(lobby.bucket_key);
    const relicName = this.relicName(relicId);
    const role: LobbyRole = viewerAccountId === lobby.host_account_id ? "host" : "member";

    const members: LobbyMemberView[] = rows.map((r) => {
      const isHost = r.account_id === lobby.host_account_id;
      const view: LobbyMemberView = {
        accountId: r.account_id,
        ign: r.ign,
        platform: (r.platform as Platform | null) ?? null,
        masteryRank: r.mastery_rank,
        isHost,
        isYou: r.account_id === viewerAccountId,
        hasLeft: r.left_at !== null,
      };
      // The asymmetry, enforced by the data rather than by a client-side flag.
      if (role === "host" && !isHost) {
        view.whisper = r.ign === null ? null : buildWhisper(r.ign, relicName, refinement);
      }
      return view;
    });

    const hostRow = rows.find((r) => r.account_id === lobby.host_account_id);

    return {
      lobbyId: lobby.lobby_id,
      shareCode: lobby.share_code,
      bucketKey: lobby.bucket_key,
      relicName,
      refinement,
      role,
      hostAccountId: lobby.host_account_id,
      hostIgn: role === "host" ? null : (hostRow?.ign ?? null),
      members,
      whisperFormat: whisperFormat(relicName, refinement),
      createdAt: lobby.created_at,
      expiresAt: lobby.expires_at,
      closedAt: lobby.closed_at,
    };
  }

  /**
   * Reconnect, derived from the AUTHENTICATED ACCOUNT rather than from a stored
   * token — so a second device, a private window or cleared site data all still
   * work. A `localStorage` token is an optimization for the anonymous fast path
   * only, never the sole key.
   */
  openLobbyFor(accountId: AccountId, now: number): LobbyId | null {
    const row = this.db
      .query<{ lobby_id: string }, [string, number]>(
        `SELECT l.lobby_id
           FROM lobby_members m
           JOIN lobbies l ON l.lobby_id = m.lobby_id
          WHERE m.account_id = ?
            AND m.left_at IS NULL
            AND l.closed_at IS NULL
            AND l.expires_at > ?
          ORDER BY l.created_at DESC
          LIMIT 1`,
      )
      .get(accountId, now);
    return row?.lobby_id ?? null;
  }

  byShareCode(code: ShareCode): LobbyId | null {
    const row = this.db
      .query<{ lobby_id: string }, [string]>("SELECT lobby_id FROM lobbies WHERE share_code = ?")
      .get(code.toUpperCase());
    return row?.lobby_id ?? null;
  }

  /**
   * Explicit leave. The lobby continues at three and there is NO backfill — the
   * remaining members press Queue again. The row is marked rather than deleted
   * so the host can still see who was already whispered.
   *
   * Dissolves the lobby when the last member goes.
   */
  leave(lobbyId: LobbyId, accountId: AccountId, now: number): { dissolved: boolean } {
    const changed = this.db
      .query(
        `UPDATE lobby_members SET left_at = ?
          WHERE lobby_id = ? AND account_id = ? AND left_at IS NULL`,
      )
      .run(now, lobbyId, accountId).changes;

    if (changed === 0) return { dissolved: false };

    const remaining = this.db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM lobby_members WHERE lobby_id = ? AND left_at IS NULL",
      )
      .get(lobbyId)!.n;

    if (remaining > 0) return { dissolved: false };
    return { dissolved: this.close(lobbyId, now) };
  }

  /** Dissolution. Idempotent: closing a closed lobby reports false. */
  close(lobbyId: LobbyId, now: number): boolean {
    return (
      this.db
        .query("UPDATE lobbies SET closed_at = ? WHERE lobby_id = ? AND closed_at IS NULL")
        .run(now, lobbyId).changes > 0
    );
  }

  /** Everything past its two-hour ceiling. Returns what it closed. */
  expire(now: number): LobbyId[] {
    const rows = this.db
      .query<{ lobby_id: string }, [number]>(
        "SELECT lobby_id FROM lobbies WHERE closed_at IS NULL AND expires_at <= ?",
      )
      .all(now);
    for (const r of rows) this.close(r.lobby_id, now);
    return rows.map((r) => r.lobby_id);
  }

  isOpen(lobbyId: LobbyId, now: number): boolean {
    const row = this.db
      .query<{ closed_at: number | null; expires_at: number }, [string]>(
        "SELECT closed_at, expires_at FROM lobbies WHERE lobby_id = ?",
      )
      .get(lobbyId);
    return row !== null && row !== undefined && row.closed_at === null && row.expires_at > now;
  }

  /** Retries rather than trusting one draw. 32^6 makes a second collision remote. */
  #codeAttempts = 8;
  private uniqueCode(): ShareCode {
    for (let i = 0; i < this.#codeAttempts; i += 1) {
      const code = this.newCode();
      if (this.byShareCode(code) === null) return code;
    }
    throw new Error("could not generate an unused share code");
  }
}

/** Self-declared profile fields. Nothing here is verified — DE exposes no player API. */
export function upsertAccount(
  db: Database,
  account: {
    accountId: AccountId;
    ign?: string | null;
    platform?: Platform | null;
    masteryRank?: number | null;
  },
  now: number,
): void {
  db.query(
    `INSERT INTO accounts (account_id, ign, platform, mastery_rank, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       ign = excluded.ign,
       platform = excluded.platform,
       mastery_rank = excluded.mastery_rank`,
  ).run(
    account.accountId,
    account.ign ?? null,
    account.platform ?? null,
    account.masteryRank ?? null,
    now,
  );
}

let counter = 0;
const defaultId = (): string => `l${(counter += 1).toString(36)}${Date.now().toString(36)}`;

function defaultCode(): ShareCode {
  const bytes = crypto.getRandomValues(new Uint8Array(SHARE_CODE_LENGTH));
  let out = "";
  for (const b of bytes) out += SHARE_CODE_ALPHABET[b % SHARE_CODE_ALPHABET.length];
  return out;
}

export { SQUAD_SIZE, type BucketKey };
