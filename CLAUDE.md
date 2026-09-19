# radshare.io

Presence-based relic squad queue for Warframe. Players pick one or more
(relic, refinement) pairs, join a live queue, and are auto-matched into a squad of
four. The design doc is `docs/designs/radshare-queue.md`.

Stack: TypeScript end to end. Bun + Hono (serves the prerendered SvelteKit client and
terminates the WebSocket on one origin), SvelteKit + Tailwind, Postgres. Monorepo:
`apps/server`, `apps/web`, `packages/protocol`. Relic data vendored from WFCD as
build-time JSON.

Two naming rules that are load-bearing:

- A **bucket** is pre-match. A **lobby** is post-match. They never share a word in the
  UI or in the code.
- The match pass (evict from all buckets, snapshot members, compute deltas) is one
  synchronous function with **zero `await`s**. The Postgres insert and the broadcast
  happen after it returns. Violating this strands a bucket at 4/4.

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
