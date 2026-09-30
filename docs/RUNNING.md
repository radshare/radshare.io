# Running radshare

Two processes: the Bun host (`/api` + `/ws`) and the SvelteKit client. Vite
proxies both to the host, which is the arrangement Caddy provides in production.

## Local, without Clerk

Fastest path. No keys, no account anywhere.

```powershell
# terminal 1
$env:RADSHARE_DEV_AUTH = "1"
bun apps/server/src/index.ts

# terminal 2
bun run dev
```

Then open the sign-in link the server prints:

```
http://localhost:5173/api/dev-login?account=you&ign=zylok
```

It sets a cookie, creates the account, and redirects to the board. A cookie
rather than a header because **a browser cannot put a header on a WebSocket
handshake** — `new WebSocket(url)` takes none.

The bypass is gated twice: `RADSHARE_DEV_AUTH=1` **and** `NODE_ENV !== production`.
`/api/dev-login` is not registered unless both hold.

To put real entries on the board without four browsers:

```powershell
bun scripts/dev-queue.ts --count 4 --relic "Axi A1"
```

Close it and the board empties, exactly as it would for real people.

## Local, with Clerk

```powershell
# terminal 1 -- do NOT set RADSHARE_DEV_AUTH
$env:CLERK_SECRET_KEY = "sk_test_..."
$env:CLERK_PUBLISHABLE_KEY = "pk_test_..."
bun apps/server/src/index.ts

# terminal 2
bun run dev
```

and in `apps/web/.env`:

```
PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Both halves need the publishable key: the browser to load Clerk, the server to
resolve a handshake. The secret key is server-only and must never reach
`apps/web`, where anything prefixed `PUBLIC_` is shipped to the browser.

### Clerk dashboard settings

- **Sign-in options**: email, plus Discord and Xbox if you want them. Discord as
  a login provider is fine; Discord as a product surface is not the point.
- **Paths**: the Account Portal defaults are correct. There is no sign-in page
  of ours to keep in sync — `redirectToSignIn()` goes to Clerk's hosted one.
- Steam is not available and is deferred by design: it is OpenID 2.0 rather than
  OAuth2, so Clerk cannot broker it.

### What signing in does and does not do

**A Clerk session by itself creates nothing.** `accounts.ign` is `NOT NULL` with
a non-blank `CHECK`, so a row exists only once an in-game name is set. The flow
is therefore three states, and the client renders each:

| `/api/me` | Screen |
|---|---|
| `{ signedIn: false }` | board, plus **Sign in to queue** |
| `{ signedIn: true, hasAccount: false }` | first-run: ask for the in-game name |
| `{ signedIn: true, hasAccount: true }` | the composer, and the socket opens |

Queueing before a name is set is refused with `IGN_REQUIRED` at the join, not at
match time — discovering it when a lobby is written would fail a match three
other people had already confirmed.

## Environment

| Variable | Where | Meaning |
|---|---|---|
| `PORT`, `HOST` | server | defaults `3000`, `127.0.0.1` |
| `RADSHARE_DB` | server | SQLite path. `:memory:` for a throwaway run |
| `CLERK_SECRET_KEY` | server | **required in production**; boot fails without it |
| `CLERK_PUBLISHABLE_KEY` | server | needed to resolve a Clerk handshake |
| `RADSHARE_AUTHORIZED_PARTIES` | server | comma-separated origins, e.g. `https://radshare.io` |
| `RADSHARE_DEV_AUTH` | server | `1` enables the local bypass. Ignored in production |
| `PUBLIC_CLERK_PUBLISHABLE_KEY` | web | shipped to the browser |
| `RADSHARE_SERVER` | web, dev only | proxy target, default `http://127.0.0.1:3000` |

Set `RADSHARE_AUTHORIZED_PARTIES` in production. Without it Clerk accepts a
token minted for any origin.

## Commands

```
bun test                      # 383 tests
bun run check                 # tsc + svelte-check
bun run build                 # production client
bun scripts/vendor-relics.ts  # regenerate the WFCD relic list
bun scripts/preview-gong.ts   # render the match gong to a WAV
```
