/**
 * Who is signed in, and have they finished signing up.
 *
 * Two questions, not one. Clerk answers the first; only the server answers the
 * second, because an account exists in our database only once an in-game name
 * has been set. A Clerk session by itself buys nothing.
 *
 * Clerk's VANILLA SDK, not the community SvelteKit one — the thing that decides
 * whether a socket may hold queue entries stays on a first-party package.
 *
 * The session cookie Clerk sets on this origin is what the server verifies, and
 * it is also what the WebSocket upgrade carries: a browser cannot put a header
 * on `new WebSocket(url)`, so cookie-based session is not a convenience here,
 * it is the only thing that works.
 */

import { browser } from "$app/environment";

export type SessionState =
  | { status: "loading" }
  /** Clerk is not configured. Dev auth, or a misconfigured deploy. */
  | { status: "unavailable" }
  | { status: "signed-out" }
  /** Signed in, but no in-game name yet — show the first-run screen. */
  | { status: "needs-ign"; accountId: string }
  | { status: "ready"; accountId: string };

type Me =
  | { signedIn: false }
  | { signedIn: true; accountId: string; hasAccount: boolean };

type ClerkLike = {
  load(opts?: Record<string, unknown>): Promise<void>;
  user: unknown;
  redirectToSignIn(opts?: Record<string, unknown>): void;
  signOut(): Promise<void>;
};

export class SessionStore {
  state = $state<SessionState>({ status: "loading" });
  #clerk: ClerkLike | null = null;

  /**
   * `publishableKey` empty means Clerk is not configured — the dev-auth path.
   * The server is still asked who we are, because the dev cookie answers it.
   */
  async start(publishableKey: string): Promise<void> {
    if (!browser) return;

    if (publishableKey) {
      try {
        const { Clerk } = await import("@clerk/clerk-js");
        const clerk = new Clerk(publishableKey) as unknown as ClerkLike;
        await clerk.load({});
        this.#clerk = clerk;
      } catch {
        // A Clerk outage must not blank the board. Anonymous browsing is the
        // proof surface and it needs no session at all.
        this.state = { status: "unavailable" };
        return;
      }
    }

    await this.refresh();
  }

  /** Re-asks the server. Called after sign-in and after setting a name. */
  async refresh(): Promise<void> {
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      if (!res.ok) {
        this.state = { status: "unavailable" };
        return;
      }
      const me = (await res.json()) as Me;
      if (!me.signedIn) {
        this.state = { status: "signed-out" };
        return;
      }
      this.state = me.hasAccount
        ? { status: "ready", accountId: me.accountId }
        : { status: "needs-ign", accountId: me.accountId };
    } catch {
      this.state = { status: "unavailable" };
    }
  }

  /** Clerk's hosted sign-in. No sign-in form of ours to keep in sync. */
  signIn(): void {
    this.#clerk?.redirectToSignIn({ redirectUrl: location.href });
  }

  async signOut(): Promise<void> {
    await this.#clerk?.signOut();
    this.state = { status: "signed-out" };
  }

  /** Whether a sign-in button can do anything. */
  get canSignIn(): boolean {
    return this.#clerk !== null;
  }

  /**
   * Sets the in-game name and finishes sign-up.
   *
   * Returns an error string rather than throwing: this is a form, and a form
   * that throws is a form that loses what the user typed.
   */
  async setIgn(ign: string, platform: string | null): Promise<string | null> {
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ign, platform }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return body.error === "IGN_REQUIRED"
          ? "Enter your in-game name. The host needs it to invite you."
          : "That didn't save. Try again.";
      }
      await this.refresh();
      return null;
    } catch {
      return "That didn't save. Try again.";
    }
  }
}

export const session = new SessionStore();
