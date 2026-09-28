/**
 * The auth boundary.
 *
 * Clerk hosted sign-in, verified SERVER-SIDE with the official `@clerk/backend`.
 * The community SvelteKit SDK is deliberately kept out of this path: the thing
 * that decides whether a socket may hold queue entries is worth keeping on a
 * first-party, maintained verifier.
 *
 * Steam is deferred. It is OpenID 2.0 rather than OAuth2, so Clerk cannot
 * broker it and it would need its own verifier — out of scope for v1.
 *
 * One function is the whole surface: a request in, an account id or null out.
 * Everything downstream takes an `AccountId` and knows nothing about Clerk,
 * which is what lets the hub tests run without a network.
 */

import { createClerkClient, type ClerkClient } from "@clerk/backend";
import type { AccountId } from "@radshare/protocol";

export type Authenticator = (req: Request) => Promise<AccountId | null>;

/**
 * Verifies the Clerk session on the request and returns the Clerk user id,
 * which IS the account id — there is no second identity table to keep in sync.
 */
export function clerkAuthenticator(client: ClerkClient, authorizedParties?: string[]): Authenticator {
  return async (req) => {
    try {
      const state = await client.authenticateRequest(
        req,
        authorizedParties ? { authorizedParties } : {},
      );
      if (!state.isAuthenticated) return null;

      // Clerk can also authenticate machine tokens, which carry no user. Only a
      // session token identifies a person, and only a person can hold a queue
      // entry — so anything else is rejected rather than coerced.
      const auth = state.toAuth();
      return "userId" in auth ? (auth.userId ?? null) : null;
    } catch {
      return null;
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

/** The cookie a browser carries once `/api/dev-login` has been visited. */
export const DEV_COOKIE = "radshare_dev";

/**
 * Identifies the caller from a header, a cookie or a query parameter. LOCAL
 * DEVELOPMENT ONLY.
 *
 * Three sources because the three callers differ. A script can set a header; a
 * BROWSER CANNOT — `new WebSocket(url)` takes no headers at all — so the
 * browser path needs a cookie, and the query parameter is how that cookie gets
 * set in the first place.
 *
 * Gated twice on purpose — an explicit opt-in AND a non-production
 * environment — because a dev bypass that one variable enables is a dev bypass
 * that eventually ships. `buildAuthenticator` refuses to return this when
 * `NODE_ENV === "production"` no matter what else is set.
 */
export function devAuthenticator(): Authenticator {
  return async (req) => {
    const header = req.headers.get("x-dev-account");
    if (header) return header;

    const query = new URL(req.url).searchParams.get("dev");
    if (query) return query;

    return readCookie(req.headers.get("cookie"), DEV_COOKIE);
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

/** True when the dev bypass is the active authenticator. */
export function isDevAuth(env: AuthEnv): boolean {
  return env.NODE_ENV !== "production" && env.RADSHARE_DEV_AUTH === "1";
}

/**
 * Picks the authenticator and fails LOUDLY rather than falling back.
 *
 * A misconfigured production box must not start and quietly accept a header,
 * so a missing secret key throws at boot instead of degrading.
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
