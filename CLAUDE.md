# radshare.io

Presence-based relic squad queue for Warframe. Players pick one or more
(relic, refinement) pairs, join a live queue, and are auto-matched into a squad of
four. The design doc is `docs/designs/radshare-queue.md`.

Stack: TypeScript end to end. Bun + Hono (serves the SvelteKit client and terminates the
WebSocket on one origin), SvelteKit + Tailwind, **SQLite via the built-in `bun:sqlite`** on the
VPS's local disk, backed up with litestream. Monorepo: `apps/server`, `apps/web`, `packages/protocol`.
Relic data vendored from WFCD as build-time JSON.

Deployment is a small VPS: Caddy in front for automatic TLS, systemd running the Bun process with
`Restart=always`, SQLite on the local disk, litestream replicating to object storage. One box and
one process by construction — there is no autoscaling to disable and no rolling deploy that could
fork the database.

Caddy is a reverse proxy, so the socket peer Bun sees is `::ffff:127.0.0.1` — and because Caddy
pools its upstream connection, that peer is *shared between different visitors*. **Per-IP limits
must read `X-Forwarded-For`**; keying on the peer counts the entire userbase as one person.

Verified: Caddy 2.11.4 **replaces** `X-Forwarded-For` rather than appending, so forged values from
a client are discarded and reading the header directly is safe. Adding `trusted_proxies` to the
Caddyfile changes that — do not add it without re-testing.

Auth: Clerk hosted sign-in, verified server-side with the official `@clerk/hono`. The community
SvelteKit SDK is deliberately kept out of the auth path. Steam is deferred (OpenID 2.0, not
OAuth2, so Clerk cannot broker it).

Content follows queue state; transport follows authentication:

- **Anonymous** — cached `GET /api/board`, 10s cache, polled every 10s, server-rendered into
  first paint so a visitor from Reddit sees a populated board before JS runs. Never holds a
  socket.
- **Signed in** — WebSocket, whether queued or not. Live global updates are what prompt someone
  to join a near-full bucket. `queue.join` / `queue.leave` swap the subscription between the
  global stream and your own buckets.

A bucket reaching four does **not** create a lobby. It opens a **ready check**: all four confirm
within 60s or the match is void — non-confirmers are removed from the queue, confirmers go back
to their buckets with their original `enqueuedAt`. There is **no reputation system**; the ready
gate is the only enforcement. The one measurement is `radshare_successful`, recorded when three
of four press **Good squad** in the lobby, and nothing reads it.

Two naming rules that are load-bearing:

- A **bucket** is pre-match. A **lobby** is post-match. They never share a word in the
  UI or in the code.
- The match pass (evict from all buckets, snapshot members, compute deltas) is one
  synchronous function with **zero `await`s**. The database insert and the broadcast
  happen after it returns. Violating this strands a bucket at 4/4.

## Presence (verified)

Bun **1.4.2**, pinned. Do not configure a ping interval — set `idleTimeout` and Bun pings at half
of it (measured: 8s timeout gave pongs at 4/8/12/16s). **`idleTimeout: 30`.** There is no sweep
and no `lastPongAt` bookkeeping: Bun evicts on timeout and fires `close`, and bucket eviction
happens there.

**Any close evicts immediately — there is no grace window and no close-code branch.** An account
is evicted when its LAST socket closes; several clients may share an account. A killed peer fires
`close` in ~1ms, so only a silent death costs the full 30s, and that is the complete worst case
for a stale board.

Close codes are still verified and distinguishable (1000/1001 clean, 1006 abnormal, unchanged
through Caddy) — the design just no longer needs them.

## Testing

Test runner: `bun test` (built in; Jest-compatible API). No Vitest, no Jest.

Run: `bun test` · single file: `bun test path/to/file.test.ts`

The matcher is the part that must be tested before any UI exists. It is testable because
`planMatch(buckets, request, now)` is pure: time is injected and the function returns a plan
object rather than performing I/O.

Bucket entries are `{ accountId, enqueuedAt }` — **no connection reference at all**. Connections
live in a separate registry (`Map<AccountId, Set<ConnectionId>>`) holding opaque ids rather than
socket objects, because an account may hold several sockets and is evicted only when its last one
closes. Never reintroduce a direct `Date.now()` or a socket reference into the matcher — it makes
every ordering test timing-dependent.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
