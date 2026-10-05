# radshare.io

A presence-based squad queue for Warframe relic sharing. Pick the relics you
hold, join a live queue, get matched with three other people holding the same
one.

Status: **not deployed.** The loop works end to end locally.

## How it works

1. Sign in, declare your in-game name, and pick one or more (relic, refinement)
   pairs — up to 20.
2. The board swaps from the global top 60 to your own buckets. The tab can be
   minimised; the socket holds your place.
3. A bucket reaching four opens a **ready check** rather than a squad: all four
   confirm within 60 seconds or the match is void.
4. On four confirmations a lobby opens with a host — the longest waiter. The host
   gets three ready-to-paste `/w` invites; nobody else gets any.
5. The host whispers, the squad forms in Warframe, everyone leaves the browser.

A queue entry lives inside a WebSocket, so closing the tab removes it within
milliseconds and losing the network removes it within 30 seconds. The board can
only show people who are connected right now.

Behaviour that is deliberate and easy to mistake for a bug:

- **No grace window on disconnect.** Any close evicts, with no close-code branch.
  The client re-queues from `localStorage` on reconnect.
- **No reputation system.** No thumbs, no scores, no `ratings` table. The ready
  check is the only enforcement.
- **The lobby is asymmetric in the data.** The `whisper` field exists only on the
  host's view of the other three rows, so a non-host client cannot render a copy
  button at all.
- **Presence is never seeded.** An empty board says it is empty, and
  "players queued" counts distinct accounts holding an entry — not sockets, not
  anonymous readers.
- **Web only.** No desktop client and no log parsing. The last mile is always an
  in-game invite.

Full reasoning, including what was rejected, is in
[`docs/designs/radshare-queue.md`](docs/designs/radshare-queue.md).

## Stack

TypeScript end to end, on Bun 1.4.2 (pinned).

| | |
|---|---|
| Server | Bun + Hono — serves the client and terminates the WebSocket on one origin |
| Client | SvelteKit 2 + Svelte 5 runes, Tailwind v4 |
| Storage | SQLite via `bun:sqlite` on local disk, litestream to object storage |
| Auth | Clerk hosted sign-in, verified server-side with `@clerk/backend` |
| Relic data | Vendored from [WFCD](https://github.com/WFCD) as build-time JSON |

Deployment target is one small VPS: Caddy in front for TLS, systemd with
`Restart=always`, SQLite on the local disk. One box and one process — no
autoscaling to disable, and no rolling deploy that could fork the database.

## Layout

```
apps/server/            Bun + Hono host
  matcher.ts              pure, synchronous, zero awaits
  readygate.ts            the 60s confirmation window
  lobby.ts                post-match, durable, asymmetric
  board.ts                two modes, one surface
  hub.ts                  where the above meet a socket
apps/web/               SvelteKit client
  lib/connection.ts       socket client, transport injected
  lib/boardState.ts       snapshot/delta reducer
packages/protocol/      wire types, shared both ways
  relics.generated.json   798 relics, 764 vaulted
scripts/                vendor relic data, drive a local queue, render the gong
docs/                   design doc and RUNNING.md
```

A **bucket** is pre-match, a **lobby** is post-match, and they never share a word
in the UI or the code.

## Running it

Full setup, including Clerk, is in [`docs/RUNNING.md`](docs/RUNNING.md). Without
a Clerk account:

```powershell
# terminal 1
$env:RADSHARE_DEV_AUTH = "1"
bun apps/server/src/index.ts

# terminal 2
bun run dev
```

Open the sign-in link the server prints, then populate the board:

```powershell
bun scripts/dev-queue.ts --count 4 --relic "Axi A1"
```

That is a driver, not a seeder — real accounts holding real entries, so closing
it empties the board. It refuses any host but localhost.

### Commands

```
bun test                      # 383 tests
bun run check                 # tsc + svelte-check
bun run build                 # production client
bun scripts/vendor-relics.ts  # regenerate the WFCD relic list
bun scripts/preview-gong.ts   # render the match gong to a WAV
```

## Testing

`bun test` only — no Vitest, no Jest.

`planMatch(buckets, request, now)` is pure: time is injected, the bucket layer
holds opaque account ids rather than sockets, and it returns a plan object rather
than performing I/O. The ready gate, lobby, board and client connection layer
follow the same rule — each takes its clock, transport or storage as a parameter,
so a 60-second gate is tested without sleeping for 60 seconds.

Each slice is also driven against a real `Bun.serve` with real WebSockets before
being called done.

## Contributing

Read `CLAUDE.md` first — it carries the invariants that are expensive to
rediscover, such as the zero-`await` match pass and why per-IP limits must read
`X-Forwarded-For` behind Caddy.

`DESIGN.md` is the source of truth for colour, type and spacing. No component may
write a hex literal; a test fails the build if one does.

## Licence

Not yet chosen. Warframe and Void Relics are trademarks of Digital Extremes; this
is an unofficial fan project with no affiliation.
