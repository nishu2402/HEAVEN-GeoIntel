import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { posterSvg } from "@/lib/brand/poster";
import { bannerPlain, bannerAnsi, bannerTrueColor, bannerWidth } from "@/lib/brand/banner";
import { USERNAME_SITES } from "@/lib/data/usernameSites";
import { posterStats, usernameCatalog } from "../scripts/poster-stats.mjs";

// The committed poster and terminal banner are GENERATED artefacts that make
// factual claims. "Remember to run `npm run brand`" is not a control — this is.
// If the version changes, a source is added, or a username site is dropped, the
// artwork is stale and these tests say so with the exact command to fix it.

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FIX = "stale generated asset — run `npm run brand:poster`";

const stats = posterStats(ROOT);

describe("the stats the artwork is allowed to print", () => {
  it("counts the username catalog correctly by parsing it", () => {
    // poster-stats.mjs parses usernameSites.ts because importing it in plain
    // Node fails on the overlay module's extensionless specifier. This is the
    // check that the parse still agrees with the real array — without it, a
    // refactor of that file would silently make the poster claim zero sites.
    const parsed = usernameCatalog(ROOT);
    expect(parsed.total).toBe(USERNAME_SITES.length);
    expect(parsed.manual).toBe(USERNAME_SITES.filter((s) => s.check === "manual").length);
    expect(parsed.auto).toBe(USERNAME_SITES.filter((s) => s.check !== "manual").length);
    expect(parsed.total).toBeGreaterThan(0);
  });

  it("reads the coverage threshold the gate actually enforces", () => {
    expect(read("vitest.config.ts")).toContain(`statements: ${stats.coverage}`);
  });
});

describe("committed poster artwork is current", () => {
  it.each([
    ["public/brand/poster.svg", { theme: "dark" as const }],
    ["public/brand/poster-light.svg", { theme: "light" as const }],
    ["public/brand/poster-still.svg", { theme: "dark" as const, animated: false }],
  ])("%s matches what the generator would write today", (file, options) => {
    expect(read(file), FIX).toBe(posterSvg(stats, options) + "\n");
  });

  it("the README embeds both themes and the alt text is not empty", () => {
    const readme = read("README.md");
    expect(readme).toContain('srcset="public/brand/poster-light.svg"');
    expect(readme).toContain('srcset="public/brand/poster.svg"');
    expect(readme).toMatch(/<img width="100%" src="public\/brand\/poster\.svg" alt="[^"]{40,}"/);
  });
});

describe("committed terminal banner is current", () => {
  const sh = () => read("scripts/banner.sh");

  it("holds every plain line the module renders today", () => {
    for (const line of bannerPlain(stats)) {
      expect(sh(), FIX).toContain(`printf '%s\\n' '${line}'`);
    }
  });

  it("holds every 256-colour line the module renders today", () => {
    for (const line of bannerAnsi(stats)) {
      expect(sh(), FIX).toContain(`printf '%s\\n' '${line}'`);
    }
  });

  it("holds every 24-bit line the module renders today", () => {
    for (const line of bannerTrueColor(stats)) {
      expect(sh(), FIX).toContain(`printf '%s\\n' '${line}'`);
    }
  });

  it("picks a tier: plain on NO_COLOR or a pipe, truecolor when advertised", () => {
    // Piping the launcher's output into a log file should not fill it with
    // escape codes; a truecolor terminal should get the gradient.
    const src = sh();
    expect(src).toContain('if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then');
    expect(src).toContain('hv_banner_plain');
    expect(src).toContain('"${COLORTERM:-}" = "truecolor"');
    expect(src).toContain('hv_banner_truecolor');
  });

  it("is a box whose every row is the same width", () => {
    const rows = bannerPlain(stats);
    const widths = new Set(rows.map((r) => [...r].length));
    expect(widths).toEqual(new Set([bannerWidth(stats) + 2]));
  });

  it("matches the copy pasted into the README", () => {
    // The README shows the banner in a code fence. A screenshot of a thing is
    // exactly where drift hides, so it is checked like everything else.
    const readme = read("README.md");
    for (const line of bannerPlain(stats)) expect(readme, FIX).toContain(line);
  });

  it("is sourced by the launcher, the installer and the uninstaller", () => {
    // All three, so the mark is the same on the way in, in use, and on the way
    // out — and all three tolerate it being absent on a fresh clone.
    for (const script of ["scripts/start.sh", "scripts/install-global.sh", "scripts/uninstall-global.sh"]) {
      const src = read(script);
      expect(src, script).toContain('if [ -f "$SCRIPT_DIR/banner.sh" ]; then');
      expect(src, script).toContain('. "$SCRIPT_DIR/banner.sh"');
      expect(src, script).toContain("hv_banner");
    }
  });
});
