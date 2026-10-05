# radshare.io

A presence-based squad queue for Warframe relic sharing. Pick the relics you
hold, join a live queue, get matched with three other people holding the same
one.

Status: **not deployed.** The loop works end to end locally.

## The problem

Radsharing needs four people with the same relic at the same refinement, at the
same time. Recruiting chat fills common relics in seconds and rare or vaulted
ones not at all, and every Warframe LFG board that has tried to fix this reads
`0/0` within a week.

They fail the same way. **A listing outlives its poster.** Someone posts "LF 3
Axi G9 rad", closes the tab, and the listing sits there looking live for an hour.
The board fills with rows nobody is behind, and the next visitor learns not to
trust it.

So this is **presence, not posting**. A queue entry lives inside a WebSocket.
Close the tab and you are out of the queue within milliseconds; lose your network
and you are out within 30 seconds. The board can only ever show people who are
there right now, because there is nowhere else for an entry to live.

That constraint is the product. Everything below follows from it.

## How it works

1. Sign in, declare your in-game name, pick one or more (relic, refinement)
   pairs — up to 20.
2. The board swaps from the global top 60 to your own buckets. You can minimise
   the tab; the socket holds your place.
3. A bucket reaching four does **not** make a squad. It opens a **ready check**:
   all four confirm within 60 seconds or the match is void.
4. On four confirmations a lobby opens, with a host designated — the longest
   waiter. The host gets three ready-to-paste `/w` invites; nobody else gets any.
5. The host whispers, the squad forms in Warframe, everyone abandons the browser.
   That last part is the happy path and nothing punishes it.

### Decisions worth knowing before reading the code

**The ready gate replaced a reputation system.** Thumbs, scores and exclusion
thresholds were designed and then cut: a score needs volume before it means
anything, and it becomes an unappealable ban without a rolling window and an
escape path. A 60-second gate enforces attendance immediately, applies itself,
and works with four users as well as forty thousand. There is no reputation
anywhere in this product and no `ratings` table.

**No grace window.** A disconnect evicts you immediately — no 60-second hold, no
close-code branch. The board must not vouch for someone who is not connected.
The client re-queues from `localStorage` on reconnect, which covers a blip
without the board ever lying.

**The lobby is asymmetric in the data, not in the UI.** The `whisper` field
exists only on the host's view of the other three rows. A non-host client cannot
render a copy-whisper button because it was never sent the material to build one.
Four people each whispering three others is twelve whispers and colliding
invites.

**Never seed fake presence.** Not on the board, not in the activity counts, not
in launch material. An empty board says it is empty. The one number that could
be inflated — "players queued now" — counts distinct accounts holding an entry,
never sockets and never anonymous readers.

**Web only, forever.** No desktop client, no log parsing. The app cannot put
anyone in a squad; the last mile is always an in-game invite, and that is fine.

The full reasoning, including what was rejected and why, is in
[`docs/designs/radshare-queue.md`](docs/designs/radshare-queue.md).

## Stack

TypeScript end to end, on Bun 1.4.2 (pinned).

| | |
|---|---|
| Server | Bun + Hono — serves the client and terminates the WebSocket on one origin |
| Client | SvelteKit 2 + Svelte 5 runes, Tailwind v4 |
| Storage | SQLite via `bun:sqlite`, on local disk, litestream to object storage |
| Auth | Clerk hosted sign-in, verified server-side with `@clerk/backend` |
| Relic data | Vendored from [WFCD](https://github.com/WFCD) as build-time JSON |

Deployment is **one small VPS**: Caddy in front for TLS, systemd with
`Restart=always`, SQLite on the local disk. One box and one process by
construction — no autoscaling to disable, and no rolling deploy that could fork
the database.

## Layout

```
apps/server/      Bun + Hono host
  matcher.ts        pure, synchronous, zero awaits — the load-bearing piece
  readygate.ts      the 60s confirmation window
  lobby.ts          post-match, durable, asymmetric
  board.ts          two modes, one surface
  hub.ts            where the above meet a socket
apps/web/         SvelteKit client
  lib/connection.ts   socket client, transport injected
  lib/boardState.ts   snapshot/delta reducer
packages/protocol/  wire types, shared both ways
  relics.generated.json   798 relics, 764 vaulted
scripts/          vendor relic data, drive a local queue, render the gong
docs/             design doc and RUNNING.md
```

**A bucket is pre-match. A lobby is post-match.** They never share a word, in
the UI or in the code.

## Running it

See [`docs/RUNNING.md`](docs/RUNNING.md). The short version, with no Clerk
account needed:

```powershell
# terminal 1
$env:RADSHARE_DEV_AUTH = "1"
bun apps/server/src/index.ts

# terminal 2
bun run dev
```

Then open the sign-in link the server prints, and populate the board with:

```powershell
bun scripts/dev-queue.ts --count 4 --relic "Axi A1"
```

That is a driver, not a seeder — real accounts holding real entries, so closing
it empties the board exactly as real people would. It refuses any host but
localhost.

## Testing

```
bun test        # 383 tests
bun run check   # tsc + svelte-check
```

`bun test` only — no Vitest, no Jest.

The matcher is testable because `planMatch(buckets, request, now)` is pure: time
is injected, the bucket layer holds opaque account ids rather than sockets, and
it returns a plan object instead of performing I/O. The same discipline runs
through the ready gate, the lobby, the board and the client's connection layer —
every one takes its clock, its transport or its storage as a parameter, so a
60-second gate is tested without sleeping for 60 seconds.

Beyond the unit tests, each slice was driven against a real `Bun.serve` with real
WebSockets before being called done. Three bugs came out of those runs that no
unit test had caught: a mode flip sent as a delta so the board never swapped, a
lobby write that stranded four confirmed people when it failed, and a graceful
shutdown that left clients hanging on a dead process.

## Contributing

Read `CLAUDE.md` first. It carries the invariants that are expensive to rediscover
— the zero-`await` match pass, why per-IP limits must read `X-Forwarded-For`
behind Caddy, and why a WebSocket upgrade can only carry a cookie.

`DESIGN.md` is the source of truth for colour, type and spacing. No component may
write a hex literal; a test fails the build if one does.

## Licence

Not yet chosen. Warframe and Void Relics are trademarks of Digital Extremes; this
is an unofficial fan project with no affiliation.
