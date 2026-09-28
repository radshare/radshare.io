import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * T6's verify criterion made executable: "no hardcoded hex anywhere in
 * components".
 *
 * A design system does not collapse in one decision. It leaks one stray
 * `#1a1a1a` at a time, each defensible on its own, until half the palette is
 * unreachable and DESIGN.md describes a product that no longer exists. A test
 * is the only thing that reliably notices.
 */

const WEB = join(import.meta.dir, "..", "..", "..");
const SRC = join(WEB, "src");

/** The ONE file allowed to name a colour. Everything else references it. */
const TOKENS = join(SRC, "lib", "styles", "tokens.css");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Comments are where a rejected value is DOCUMENTED, which is the opposite of
 * using it. tokens.css deliberately names `#00FFBA` and Arial as a tripwire, so
 * a scan that cannot tell prose from code flags its own documentation.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function sourceFiles(pattern: string): string[] {
  return [...new Glob(pattern).scanSync({ cwd: SRC, absolute: true })];
}

const HEX = /#[0-9a-f]{3,8}\b/gi;

describe("no hardcoded colour outside the token file", () => {
  test("no component names a colour", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("**/*.svelte")) {
      const found = code(file).match(HEX);
      if (found) offenders.push(`${file.slice(SRC.length + 1)}: ${found.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  test("no stylesheet except tokens.css names a colour", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("**/*.css")) {
      if (file === TOKENS) continue;
      const found = code(file).match(HEX);
      if (found) offenders.push(`${file.slice(SRC.length + 1)}: ${found.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  test("no TypeScript module names a colour", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("**/*.ts")) {
      if (file.endsWith(".test.ts")) continue;
      const found = code(file).match(HEX);
      if (found) offenders.push(`${file.slice(SRC.length + 1)}: ${found.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the tokens match DESIGN.md", () => {
  const tokens = read(TOKENS);

  test.each([
    ["--bg", "#0b1116"],
    ["--surface", "#111a21"],
    ["--surface-raised", "#17232c"],
    ["--border", "#223039"],
    ["--border-strong", "#33454f"],
    ["--text", "#e8f0f4"],
    ["--text-secondary", "#8fa6b2"],
    ["--text-tertiary", "#5e7684"],
    ["--primary", "#e0a83c"],
    ["--primary-hover", "#efbb55"],
    ["--primary-pressed", "#c48f2a"],
    ["--primary-ink", "#0b1116"],
    ["--danger", "#e4634f"],
    ["--ready", "#5fc98a"],
    ["--tier-axi", "#ead9a0"],
    ["--tier-neo", "#7fc9e8"],
    ["--tier-meso", "#6e8be8"],
    ["--tier-lith", "#b58be0"],
  ])("%s is %s", (name, value) => {
    expect(tokens).toContain(`${name}: ${value};`);
  });

  test("the spacing scale is 4px-based with no off-scale value", () => {
    const scale = [4, 8, 12, 16, 24, 32, 48, 64];
    for (const n of scale) expect(tokens).toContain(`${n}px`);
    expect(tokens).toContain("--row-height: 44px");
  });
});

describe("rejected values cannot creep back", () => {
  const all = [...sourceFiles("**/*.svelte"), ...sourceFiles("**/*.css"), ...sourceFiles("**/*.ts")]
    .filter((f) => !f.endsWith(".test.ts"))
    .map(code)
    .join("\n")
    .toLowerCase();

  test("the neon primary is gone", () => {
    // Chosen to glow. Glow is cut, so the accent had to work as a flat fill.
    expect(all).not.toContain("00ffba");
  });

  test("the second gold highlight is gone", () => {
    // There is exactly one accent, and this one collided with the Axi badge.
    expect(all).not.toContain("ffd700");
  });

  test("Arial is not a type role", () => {
    // A default stack as the display voice is the "gave up on typography"
    // signal, and it has no tabular figures for a UI that is a table of numbers.
    expect(all).not.toContain("arial");
  });

  test("the canonical Axi gold did not return", () => {
    // It is the same hue as the amber primary, so an Axi badge beside a filled
    // button would read as a second button.
    expect(all).not.toContain("e3b341");
  });
});

describe("no glow", () => {
  const styles = [...sourceFiles("**/*.svelte"), ...sourceFiles("**/*.css")].map(code).join("\n");

  test("every shadow is offset, never a zero-offset halo", () => {
    // Offset plus blur is depth. Zero-offset colour is decoration, and it is
    // the single tell that most reliably makes a dark UI read as generated.
    const shadows = styles.match(/box-shadow:[^;]+;/gi) ?? [];
    for (const shadow of shadows) {
      expect(shadow).not.toMatch(/:\s*0\s+0\s/);
    }
  });

  test("the one overlay shadow has a vertical offset", () => {
    expect(read(TOKENS)).toContain("--shadow-overlay: 0 8px 24px");
  });
});

describe("accessibility rules that are checkable here", () => {
  test("body type is never below 16px", () => {
    expect(read(TOKENS)).toContain("--text-body: 16px");
  });

  test("the row height doubles as the minimum touch target", () => {
    expect(read(TOKENS)).toContain("--row-height: 44px");
  });

  test("focus is never removed", () => {
    const styles = [...sourceFiles("**/*.svelte"), ...sourceFiles("**/*.css")].map(code).join("\n");
    expect(styles).not.toMatch(/outline:\s*none/i);
    expect(read(join(SRC, "app.css"))).toContain(":focus-visible");
  });

  test("a visited link differs from an unvisited one", () => {
    expect(read(join(SRC, "app.css"))).toContain("a:visited");
    expect(read(TOKENS)).toContain("--link-visited");
  });

  test("the tier badge always carries its text label", () => {
    // Under deuteranopia neo, meso and lith converge, and tier is the board's
    // primary scanning dimension -- so the text is the information.
    const badge = read(join(SRC, "lib", "components", "TierBadge.svelte"));
    expect(badge).toContain("{tier}");
  });

  test("the board is a real table with column headers", () => {
    const board = read(join(SRC, "lib", "components", "Board.svelte"));
    expect(board).toContain("<table");
    expect(board).toContain('scope="col"');
  });

  test("count updates announce politely, never assertively", () => {
    const board = read(join(SRC, "lib", "components", "Board.svelte"));
    expect(board).toContain('aria-live="polite"');
    expect(board).not.toContain('aria-live="assertive"');
  });
});

describe("tabular figures", () => {
  test("every mono role carries them", () => {
    // A board whose counts jitter as digits change looks broken. This is a
    // correctness requirement, not a refinement.
    const css = read(join(SRC, "app.css"));
    for (const role of [".type-display", ".type-data"]) {
      const block = css.slice(css.indexOf(role), css.indexOf("}", css.indexOf(role)));
      expect(block).toContain("tabular-nums");
    }
  });
});

describe("never seed fake presence", () => {
  test("the board route invents no rows of its own", () => {
    // Every row on screen comes from the socket or from the server-rendered
    // cached board. There is no literal fallback row anywhere, so an empty
    // queue renders an empty board rather than a convincing one.
    const page = code(join(SRC, "routes", "+page.svelte"));
    expect(page).not.toMatch(/bucketKey:\s*["'`]/);
    expect(page).not.toMatch(/count:\s*[1-9]/);
  });

  test("a board that cannot be fetched renders empty rather than invented", () => {
    const load = code(join(SRC, "routes", "+page.server.ts"));
    expect(load).toContain("rows: []");
    expect(load).not.toMatch(/bucketKey:\s*["'`]/);
  });

  test("the empty state says the board is empty rather than faking it", () => {
    const board = read(join(SRC, "lib", "components", "Board.svelte"));
    expect(board).toContain("Queues appear here as Tenno join");
  });
});
