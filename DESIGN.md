---
# gstack: design-md-format=spec
name: radshare.io Design System
colors:
  background: "#0B1116"
  surface: "#111A21"
  surfaceRaised: "#17232C"
  border: "#223039"
  borderStrong: "#33454F"
  text: "#E8F0F4"
  textSecondary: "#8FA6B2"
  textTertiary: "#5E7684"
  primary: "#E0A83C"
  primaryHover: "#EFBB55"
  primaryPressed: "#C48F2A"
  primaryInk: "#0B1116"
  danger: "#E4634F"
  ready: "#5FC98A"
  tierAxi: "#EAD9A0"
  tierNeo: "#7FC9E8"
  tierMeso: "#6E8BE8"
  tierLith: "#B58BE0"
typography:
  display:
    fontFamily: "IBM Plex Mono"
    fontSize: 56px
    fontWeight: 600
  heading:
    fontFamily: "IBM Plex Sans"
    fontSize: 20px
    fontWeight: 600
  subheading:
    fontFamily: "IBM Plex Sans"
    fontSize: 13px
    fontWeight: 600
  body:
    fontFamily: "IBM Plex Sans"
    fontSize: 16px
    fontWeight: 400
  data:
    fontFamily: "IBM Plex Mono"
    fontSize: 15px
    fontWeight: 400
---

# radshare.io Design System

## Overview

A dense operations console for finding three other Warframe players who hold the same Void
Relic. Read at a glance, on a second monitor, at night, beside a dark fullscreen game.

**Mode: OPERATE.** App UI rules. Calm surface hierarchy, dense but readable, minimal chrome,
utility language. The board doubles as the marketing surface, but it is never dressed as a
landing page.

Seeded by the gstack designer from approved mockup `composite-empty.png`, then hand-corrected
during `/plan-design-review`. Three extracted values were rejected outright and the reasons are
recorded below, because they are the ones most likely to creep back.

## Corrections to the extracted values

| Extracted | Replaced with | Why |
|---|---|---|
| `Arial` for heading, subheading and body | IBM Plex Sans + IBM Plex Mono | A default stack as the display voice is the "gave up on typography" signal. Arial also has no tabular figures, and this UI is mostly numbers in a table. |
| `primary: #00FFBA` | `#E0A83C` | `#00FFBA` is a maximally saturated neon chosen to glow. Glow is cut, so the accent had to work as a flat fill. Landed briefly on a teal, then moved to amber after the regenerated lobby mockups: amber on near-black is warmer, reads as a filled button rather than as a light source, and was chosen directly from an approved visual. |
| `highlight: #FFD700` | removed as a general token | There is exactly one accent. What `#FFD700` was doing is now `--primary`, and Axi's tier badge moved out of its way (below). |

## Color

Near-black is a **use-scene decision**, not a category default: night, second monitor, beside a
dark fullscreen game. Do not "modernize" this to light.

```css
:root {
  --bg:              #0B1116;  /* page */
  --surface:         #111A21;  /* panels, table body */
  --surface-raised:  #17232C;  /* your own row, hover, active state */
  --border:          #223039;  /* hairlines */
  --border-strong:   #33454F;  /* section edges, focused inputs */

  --text:            #E8F0F4;
  --text-secondary:  #8FA6B2;  /* tinted from the surface hue, never gray */
  --text-tertiary:   #5E7684;

  --primary:         #E0A83C;  /* the only accent. QUEUE, copy whisper, primary actions */
  --primary-hover:   #EFBB55;
  --primary-pressed: #C48F2A;
  --primary-ink:     #0B1116;  /* text ON a filled primary button, never white */
  --danger:          #E4634F;  /* disconnected bar, destructive confirm */
  --ready:           #5FC98A;  /* the READY badge only. Not a second accent. */

  --tier-axi:        #EAD9A0;
  --tier-neo:        #7FC9E8;
  --tier-meso:       #6E8BE8;
  --tier-lith:       #B58BE0;
}
```

**One accent.** `--primary` is the only colour that marks an action. `--ready` and `--danger`
mark states, never actions, and never appear on a button.

**Tier colours live in the tier badge and nowhere else.** They never colour a row, a border, a
fill segment or a button — an amber row would be indistinguishable from an emphasised one — and
tier is never carried by colour alone (see *Accessibility*).

**Two tier colours were deliberately moved.** `--tier-neo` went from teal to light blue. And
`--tier-axi` went from saturated gold `#E3B341` to a pale sand `#EAD9A0` when the primary accent
became amber: Axi's canonical gold and the amber primary are the same hue, so an Axi badge
sitting next to a filled button would have read as a second button. Pale sand keeps Axi warm
and unmistakably not-an-action.

**Secondary text is tinted from the surface hue, never neutral gray.** `#8FA6B2` carries the same
blue-green cast as `--surface`.

## Typography

**IBM Plex Sans** for UI, **IBM Plex Mono** for anything that is data. One family, two widths —
tighter than the two-faces-plus-mono budget.

Plex Mono is not costume here. It earns its place three times over: in-game names are
identifiers people copy character-for-character, relic codes are codes, and every fill counter,
age and activity number is a figure that must align in a column.

| Role | Face | Size | Weight | Used for |
|---|---|---|---|---|
| Display | Plex Mono | 56px | 600 | The activity band numerals only. They are data, rendered large. |
| Heading | Plex Sans | 20px | 600 | Relic assignment in the lobby header. |
| Section label | Plex Sans | 13px | 600, tracked +0.08em, uppercase | `LIVE QUEUE BOARD`, `QUEUE COMPOSER`. |
| Body | Plex Sans | 16px | 400 | Prose, role banner, empty-state copy. Never below 16px. |
| Data | Plex Mono | 15px | 400 | IGNs, relic codes, fill counters, ages, timestamps. |
| Caption | Plex Sans | 13px | 400 | Disclaimer, footnotes, the "you're first in line" note. |

```css
font-variant-numeric: tabular-nums;  /* on every numeric cell, non-negotiable */
```

A board whose counts jitter as digits change is a board that looks broken. Tabular figures are a
correctness requirement, not a refinement.

## Spacing

4px base. Scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`.

Table rows are 44px tall — the same number as the minimum touch target, so the board needs no
separate mobile row height.

**More space above a heading than below it.** A section label sits 32px below the previous block
and 12px above its own content. Check the computed values; this is the rule that most often
survives in the spec and dies in the CSS.

## Depth, borders and motion

**No glow. Ever.** No `box-shadow` with a zero offset, no coloured halo, no neon bleed. This is
the single rule that keeps the design from reading as machine-generated, and it is the one most
likely to come back during implementation.

Emphasis is built from three things and nothing else:

1. A hairline `--border`, or `--border-strong` where a section edge needs to assert itself.
2. A raised background: `--surface-raised`.
3. Type weight.

Where genuine depth is required — a dropdown over the board, the ready-check popup —
it is an **offset** shadow with soft blur: `0 8px 24px rgba(0,0,0,0.45)`. Offset plus blur is
depth; zero-offset colour is decoration.

Radius: `2px` on inputs and buttons, `4px` on panels. Angular, not bubbly. Never the same large
radius on everything.

**One authored motion moment: the match transition** (the bucket row lifting out of the board to
become the lobby header). Ease-out, ~400ms, from an already-visible element, degrading to no
motion when the origin row was never on screen or `prefers-reduced-motion` is set. Everything
else moves at 120ms or not at all. No entrance animations on sections. No pulsing status dots —
a live board proves it is live by its numbers changing.

## Browser surfaces

These ship with browser defaults that belong to no design system. Theme them. On a screen that
is mostly a scrolling table of numbers, this is the cheapest tell that the page was designed
rather than assembled.

```css
::selection      { background: #E0A83C; color: #0B1116; }
:root            { caret-color: #E0A83C; accent-color: #E0A83C; }
::-webkit-scrollbar       { width: 10px; }
::-webkit-scrollbar-track { background: #0B1116; }
::-webkit-scrollbar-thumb { background: #223039; border-radius: 2px; }
*                { scrollbar-color: #223039 #0B1116; }
:focus-visible   { outline: 2px solid #E0A83C; outline-offset: 2px; }
a                { color: #E0A83C; text-underline-offset: 3px; }
a:visited        { color: #C9B489; }  /* visited must differ from unvisited */
```

## Components

The vocabulary. A new component needs a reason it is not one of these.

| Component | What it is | Notes |
|---|---|---|
| **Bucket row** | One `(relic, refinement)` line on the board | 44px. Relic (mono), tier badge, refinement, fill segments, count, age. Never renders `4/4` or `0/4`. |
| **Tier badge** | Small outlined pill: `AXI`, `NEO`, `MESO`, `LITH` | The only place a tier colour appears. Always carries its text label. |
| **Fill segments** | Four discrete segments, not a continuous bar | Discrete because the quantity is four people, not a percentage. Filled segments use `--primary`. At least one segment is always filled — `0/4` cannot occur, since an empty bucket is deleted rather than rendered. |
| **Relic chip** | A removable selection in the composer | Mono label, hairline border, × affordance. Chips are not cards. |
| **Activity band** | Full-width strip, two large mono numerals plus labels | Its own band, never shrunk into header chrome. |
| **Role banner** | The lobby's host / waiting instruction | Full-width, `--surface-raised`, body size. The second thing read after the relic assignment. |
| **Member name** | An IGN in the lobby list | Large, Plex Mono, high contrast, selectable. Warframe in-game names are plain — **no `#1234` discriminator**. Any mockup showing one is wrong. |
| **Copy whisper button** | Copies `/w <IGN> <invite text>` for one member | Beside the three non-host rows, **on the host's screen, at ≥601px only**. Non-hosts have nobody to invite, and on a phone the clipboard does not reach the game — so the button is absent below 601px and the names are read and typed. Three states: default, `COPIED` for 3s, and a failure state exposing selectable text when the Clipboard API is unavailable. |
| **Ready check** | The pre-lobby confirmation popup | Relic header carried from the board row, four member rows, a 60s countdown, one primary button. A confirmed member shows a `--ready` badge with its text label, never colour alone. The lobby does not exist until all four confirm. |
| **Good squad button** | The single end-of-lobby action | Optional, unattributed, group-level. Pressing it closes the lobby for that member. There is no thumbs control and no per-user score anywhere in this product. |
| **Mastery rank** | Self-declared MR from the profile | Plex Mono, secondary text. Self-declared like the IGN — DE exposes no player API — so it is a courtesy signal, never a gate. Absent when unset; no placeholder. |
| **Share code** | A short lobby code others can enter to join | Plex Mono, tracked, on `--surface-raised`. Has its own copy button. The one place a code is displayed rather than a name. |
| **Board** | Two modes, not one view with a filter | Signed out: the global top-60 list, fill descending. Signed in: starts empty, becomes your own queued buckets. No lens tabs, no toggle between them. |

**Cards only when the card is the interaction.** The mockups wrap each section in a bordered
panel; that is chrome imitating structure. Sections are separated by space and a section label.
The bucket row and the relic chip are the only card-like objects, and both are interactive.

## Responsive

**Phone support is deferred out of the first release; v1 is desktop-only.** This section is the
specification for when it lands.

Breakpoints: **≤600px** phone, **601–1024px** tablet, **≥1025px** desktop. Every screen works at
every viewport. Full per-surface layout table lives in `docs/designs/radshare-queue.md` under
*Responsive*.

Two things change below 601px. A phone is its own client, with no companion relationship to the
desktop, and it is not the machine running the game:

- **Copy-whisper buttons are absent.** The clipboard cannot reach Warframe from there. Names are
  read and typed.
- **Lobby chat collapses** behind a toggle. It is the one element the IA names as cuttable.

Nothing else is hidden.

The 44px row height doubles as the minimum touch target, so no phone-specific row metric exists.

## Accessibility

- Body text never below **16px**. Contrast **4.5:1** minimum for text, **3:1** for UI boundaries.
  `--text-tertiary` on `--bg` is for decoration only; never put information in it.
- **Tier is never carried by colour alone.** Every tier badge has its text label. This is the
  rule that matters most here: under deuteranopia `--tier-neo`, `--tier-meso` and `--tier-lith`
  converge, and tier is the board's primary scanning dimension.
- **Fill state is never carried by colour alone** either — segments are discrete shapes and the
  `N/4` count is always present in text.
- Visible focus on everything interactive: `:focus-visible`, 2px `--primary`, 2px offset. Never
  `outline: none`.
- Touch targets **44px minimum**, which the 44px row height already satisfies.
- The board is a real `<table>` with `<th scope="col">`. A screen reader should be able to read
  "Axi G9, Radiant, 3 of 4, waiting 12 minutes" from one row.
- Live count changes are announced through a **polite** live region, throttled. A board updating
  every few seconds must never fire an assertive announcement.
- `prefers-reduced-motion` disables the match transition; the routing still happens.

## Voice

Utility language. Orientation, status, action. Not mood, not brand, not aspiration.

Good: "You're first in line for Axi G9." · "zylok will invite you. Keep Warframe open." ·
"Disconnected — these counts are no longer live."

Bad: "Welcome to radshare.io!" · "Your all-in-one relic companion." · "Squad up, Tenno!"

If deleting 30% of a string improves it, keep deleting.
