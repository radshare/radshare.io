/**
 * Clerk hosted sign-in, verified server-side with the official `@clerk/backend`.
 * The community SvelteKit SDK is kept out of this path deliberately.
 *
 * Steam is deferred: OpenID 2.0 rather than OAuth2, so Clerk cannot broker it.
 *
 * The whole surface is one function — a request in, an `AuthResult` out — so
 * everything downstream knows nothing about Clerk.
 */

import { createClerkClient, type ClerkClient } from "@clerk/backend";
import type { AccountId } from "@radshare/protocol";

/**
 * `handshake` is the case that is easy to miss and fails silently.
 *
 * Clerk answers some requests with a handshake rather than a verdict: the
 * browser must bounce through Clerk's frontend API and come back before a
 * session cookie exists. Collapsing it into "signed out" leaves a signed-in
 * user looking permanently signed out, with no error anywhere — and the
 * headers it carries have to reach the response.
 */
export type AuthResult =
  | { kind: "signed-in"; accountId: AccountId }
  | { kind: "signed-out" }
  | { kind: "handshake"; headers: Headers };

export type Authenticator = (req: Request) => Promise<AuthResult>;

const SIGNED_OUT: AuthResult = { kind: "signed-out" };

/** The Clerk user id IS the account id; there is no second identity table. */
export function clerkAuthenticator(client: ClerkClient, authorizedParties?: string[]): Authenticator {
  return async (req) => {
    try {
      const state = await client.authenticateRequest(
        req,
        authorizedParties ? { authorizedParties } : {},
      );
      if (state.status === "handshake") return { kind: "handshake", headers: state.headers };
      if (!state.isAuthenticated) return SIGNED_OUT;

      // Clerk also authenticates machine tokens, which carry no user. Only a
      // person can hold a queue entry, so anything else is rejected.
      const auth = state.toAuth();
      const userId = auth && "userId" in auth ? auth.userId : null;
      return userId ? { kind: "signed-in", accountId: userId } : SIGNED_OUT;
    } catch {
      return SIGNED_OUT;
    }
  };
}

export class MissingClerkKeyError extends Error {
  constructor() {
    super("CLERK_SECRET_KEY is not set. Set it, or set RADSHARE_DEV_AUTH=1 outside production.");
    this.name = "MissingClerkKeyError";
  }
}

export type AuthEnv = {
  NODE_ENV?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  RADSHARE_DEV_AUTH?: string;
  RADSHARE_AUTHORIZED_PARTIES?: string;
};

/** Set by `/api/dev-login`. */
export const DEV_COOKIE = "radshare_dev";

/**
 * LOCAL DEVELOPMENT ONLY. Header, query parameter, then cookie.
 *
 * Three sources because the callers differ: a script sets a header, a browser
 * cannot — `new WebSocket(url)` takes none — so it needs a cookie, and the
 * query parameter is how that cookie gets set.
 *
 * Gated twice, because a bypass one variable enables eventually ships.
 */
export function devAuthenticator(): Authenticator {
  return async (req) => {
    const header = req.headers.get("x-dev-account");
    if (header) return { kind: "signed-in", accountId: header };

    const query = new URL(req.url).searchParams.get("dev");
    if (query) return { kind: "signed-in", accountId: query };

    const cookie = readCookie(req.headers.get("cookie"), DEV_COOKIE);
    return cookie ? { kind: "signed-in", accountId: cookie } : SIGNED_OUT;
  };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("=")) || null;
  }
  return null;
}

/** Whether the bypass is the active authenticator. */
export function isDevAuth(env: AuthEnv): boolean {
  return env.NODE_ENV !== "production" && env.RADSHARE_DEV_AUTH === "1";
}

/**
 * Fails LOUDLY rather than degrading: a misconfigured production box must not
 * start and quietly accept a header.
 */
export function buildAuthenticator(env: AuthEnv): Authenticator {
  if (isDevAuth(env)) return devAuthenticator();

  if (!env.CLERK_SECRET_KEY) throw new MissingClerkKeyError();

  const client = createClerkClient(
    env.CLERK_PUBLISHABLE_KEY
      ? { secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY }
      : { secretKey: env.CLERK_SECRET_KEY },
  );
  const parties = env.RADSHARE_AUTHORIZED_PARTIES?.split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  return clerkAuthenticator(client, parties?.length ? parties : undefined);
}
