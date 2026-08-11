import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Contrast guard for the two themes ────────────────────────────────────────
//
// The light theme shipped with a class of bug no unit test could see: controls
// that render BETWEEN panels — the skip link, the provenance strip, the
// add-to-case button — wore --hv-ink-dim (#8fb6a4) and --hv-glass-border on the
// #e9edf6 page. Measured on a live render that is 1.9:1 text and 1.0:1 border:
// a fully functional control that is simply not visible. The screenshot that
// reported it showed an "ADD TO CASE" button as blank space.
//
// Two things went wrong, and this suite pins both:
//
//  1. There was no token for "text on the page background". Every component
//     reached for the panel ink because that was the only ink there was.
//  2. The light theme's panel was 90% opaque, so the bright page lifted it to
//     #222734 — much paler than the dark theme's #090d18. Greys that cleared AA
//     against one landed at 4.0-4.2:1 against the other, so "it looks fine"
//     in dark mode said nothing about light mode.
//
// The numbers are recomputed from globals.css itself rather than hardcoded, so
// editing a token re-runs the maths instead of silently invalidating a comment.

const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

/** Relative luminance, WCAG 2.1. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `rgba(r,g,b,a)` over an opaque hex backdrop. */
function flatten(rgba: string, backdrop: string): string {
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (!m) return rgba;
  const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  const bh = backdrop.replace("#", "");
  const back = [0, 2, 4].map((i) => parseInt(bh.slice(i, i + 2), 16));
  return (
    "#" +
    [r, g, b]
      .map((v, i) => Math.round(v * a + back[i] * (1 - a)).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Pull one custom property out of a `:root`/`[data-theme=…]` block. */
function token(theme: "dark" | "light", name: string): string {
  const block =
    theme === "dark"
      ? css.slice(css.indexOf(":root,"), css.indexOf('[data-theme="light"]'))
      : css.slice(css.indexOf('[data-theme="light"]'));
  const m = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`token ${name} not found in the ${theme} theme`);
  return m[1].trim();
}

const AA_TEXT = 4.5;
const AA_UI = 3; // borders and other non-text component boundaries

describe("light theme — text that lands on the page background", () => {
  const page = token("light", "--hv-page-1");

  it("the page background is the bright one this suite assumes", () => {
    expect(page).toBe("#e9edf6");
  });

  it.each([
    ["--hv-ink-page", AA_TEXT],
    ["--hv-ink-page-dim", AA_TEXT],
    ["--hv-page-green", AA_TEXT],
    ["--hv-page-cyan", AA_TEXT],
    ["--hv-page-amber", AA_TEXT],
    ["--hv-page-red", AA_TEXT],
    ["--hv-page-slate", AA_TEXT],
  ])("%s clears AA on it", (name, min) => {
    expect(contrast(token("light", name), page)).toBeGreaterThanOrEqual(min);
  });

  it("--hv-border-page outlines an on-page control in BOTH themes", () => {
    // The add-to-case button is a standalone control on the bare page, not a
    // panel edge. In dark the token is translucent, so it has to be composited
    // over the page before it means anything — at the panel border's 0.16 it
    // was 1.4:1 and the button had no visible boundary at all.
    for (const theme of ["dark", "light"] as const) {
      const value = token(theme, "--hv-border-page");
      const bg = token(theme, "--hv-page-1");
      const flat = value.startsWith("rgb") ? flatten(value, bg) : value;
      expect(contrast(flat, bg)).toBeGreaterThanOrEqual(AA_UI);
    }
  });

  it("the skip link is legible when keyboard focus reveals it", () => {
    // It focuses onto --hv-page-0, not --hv-page-1, so it needs its own check.
    // Nothing else asserts this: the link is sr-only until :focus, and :focus
    // cannot be triggered in a headless render, so a live contrast sweep
    // measures its hidden state and reports nothing.
    for (const theme of ["dark", "light"] as const) {
      expect(
        contrast(token(theme, "--hv-page-green"), token(theme, "--hv-page-0")),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(["--hv-ink", "--hv-ink-dim", "--hv-green", "--hv-cyan"])(
    "%s does NOT — which is why the page tokens exist",
    (name) => {
      // Documents the trap rather than just avoiding it: these are the panel
      // tokens, and every one of them is illegible on the page. If a future
      // theme change ever makes them safe, this failing is the signal to
      // collapse the two sets — not something to "fix" by loosening the check.
      expect(contrast(token("light", name), page)).toBeLessThan(AA_TEXT);
    },
  );
});

describe("both themes present a panel of comparable darkness", () => {
  // The reason the light theme could regress invisibly: a grey checked against
  // the dark panel told you nothing about the light one.
  const darkPanel = flatten(token("dark", "--hv-glass-bg"), token("dark", "--hv-page-1"));
  const lightPanel = flatten(token("light", "--hv-glass-bg"), token("light", "--hv-page-1"));

  it("the composited panels are within 0.6 of a ratio point on mid-grey", () => {
    const probe = "#888888";
    const delta = Math.abs(contrast(probe, darkPanel) - contrast(probe, lightPanel));
    expect(delta).toBeLessThan(0.6);
  });

  it.each([
    ["--hv-ink", AA_TEXT],
    ["--hv-ink-dim", AA_TEXT],
    ["--hv-muted-ink", AA_TEXT],
    ["--hv-green", AA_TEXT],
    ["--hv-cyan", AA_TEXT],
    ["--hv-amber", AA_TEXT],
    ["--hv-red", AA_TEXT],
  ])("%s clears AA on BOTH composited panels", (name, min) => {
    expect(contrast(token("dark", name), darkPanel)).toBeGreaterThanOrEqual(min);
    expect(contrast(token("light", name), lightPanel)).toBeGreaterThanOrEqual(min);
  });
});

describe("the muted badges are legible rather than merely dim", () => {
  // .badge-neutral and .badge-unconfigured carried hardcoded #333/#555/#888.
  // "Not configured" is precisely the state an analyst needs to read, and the
  // env-var name underneath it was 1.6:1.
  it("neither badge rule reintroduces a hardcoded grey", () => {
    const rules = css.match(/\.badge-(neutral|unconfigured)\s*\{[^}]*\}/g) ?? [];
    expect(rules).toHaveLength(2);
    for (const rule of rules) expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("--hv-muted-ink clears AA on the darkest surface it lands on", () => {
    // #050505 is the SourceTabs panel body, the darkest backdrop in the app.
    for (const theme of ["dark", "light"] as const) {
      expect(contrast(token(theme, "--hv-muted-ink"), "#050505")).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
