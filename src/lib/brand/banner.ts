/**
 * HEAVEN-GeoIntel — the terminal poster.
 *
 * The same identity as the README poster, redrawn for the one surface where a
 * user meets this tool before any browser is involved: the shell. It heads
 * `scripts/start.sh`, `install-global.sh` and `uninstall-global.sh`.
 *
 * Shell scripts cannot import TypeScript, so `npm run brand` renders these
 * lines into `scripts/banner.sh` and the three scripts source that. The
 * generated file is committed (a clone must not need a build step to print its
 * own banner), and `tests/terminalBanner.test.ts` fails if it drifts from this
 * module — which is what stops "regenerate the assets" from being a step
 * anyone can silently skip.
 *
 * The mark is `LOGO_ASCII` verbatim, so the terminal, the favicon, the report
 * letterhead and the poster are all the same construction.
 */

import { BRAND, LOGO_ASCII, LOGO_ASCII_WIDTH } from "./logo";

export interface BannerStats {
  version: string;
  identifiers: number;
  modes: number;
  sources: number;
  freeSources: number;
}

/** Semantic tones, resolved to ANSI only at render time. */
export type Tone = "frame" | "mark" | "word" | "tag" | "dim" | "accent";

const ANSI: Record<Tone, string> = {
  frame: "\u001b[38;5;44m",   // cyan rule, matching --hv-cyan
  mark: "\u001b[38;5;48m",    // neon green, matching --hv-green
  word: "\u001b[1;38;5;48m",  // bold wordmark
  tag: "\u001b[38;5;108m",    // muted sage — the tagline
  dim: "\u001b[38;5;66m",     // the stat line
  accent: "\u001b[38;5;44m",  // version + separators
};

const RESET = "\u001b[0m";

/**
 * Narrowest the frame is allowed to be, in columns. Every glyph used here —
 * box-drawing, the block-element mark, `·` — is exactly one column wide.
 */
export const BANNER_MIN_WIDTH = 68;

/** Columns between the frame and the mark, and between the mark and the text. */
const PAD_LEFT = 2;
const GUTTER = 3;
/** Columns of breathing room kept to the right of the longest line. */
const PAD_RIGHT = 2;

type Seg = readonly [text: string, tone: Tone];

/** The three text rows that sit to the right of the mark. */
function textRows(s: BannerStats): (readonly Seg[])[] {
  const keyless = `${s.freeSources}/${s.sources} sources need no key`;
  return [
    [],
    [
      ["HEAVEN", "word"],
      ["-", "dim"],
      ["GeoIntel", "word"],
      ["  ", "dim"],
      [`v${s.version}`, "accent"],
    ],
    [[BRAND.tagline.toUpperCase(), "tag"]],
    [],
    [
      [`${s.identifiers} identifiers`, "dim"],
      [" · ", "frame"],
      [`${s.modes} modes`, "dim"],
      [" · ", "frame"],
      [keyless, "dim"],
    ],
  ];
}

const plainOf = (segs: readonly Seg[]): string => segs.map(([t]) => t).join("");

/**
 * Compose the framed banner as rows of coloured segments.
 *
 * Padding is computed from the *plain* text, never the coloured string — an
 * ANSI escape occupies zero columns but plenty of bytes, and padding on byte
 * length is the classic way to produce a box that doesn't line up.
 */
export function bannerWidth(s: BannerStats): number {
  // The frame grows to fit rather than clamping: a three-digit source count is
  // a reason for a wider box, never a reason to truncate a number or to let a
  // line push through the right border.
  const longest = Math.max(...textRows(s).map((r) => plainOf(r).length));
  return Math.max(BANNER_MIN_WIDTH, PAD_LEFT + LOGO_ASCII_WIDTH + GUTTER + longest + PAD_RIGHT);
}

export function bannerRows(s: BannerStats): (readonly Seg[])[] {
  const rows = textRows(s);
  const width = bannerWidth(s);
  const rule = "─".repeat(width);
  const out: (readonly Seg[])[] = [[[`╭${rule}╮`, "frame"]]];

  // textRows() returns one entry per mark row by construction, so there is no
  // missing-row case to defend against here.
  rows.forEach((row, i) => {
    const used = PAD_LEFT + LOGO_ASCII_WIDTH + GUTTER + plainOf(row).length;
    out.push([
      ["│", "frame"],
      [" ".repeat(PAD_LEFT), "frame"],
      [LOGO_ASCII[i], "mark"],
      [" ".repeat(GUTTER), "frame"],
      ...row,
      [" ".repeat(width - used), "frame"],
      ["│", "frame"],
    ]);
  });

  out.push([[`╰${rule}╯`, "frame"]]);
  return out;
}

/** The banner with no escape codes — for `NO_COLOR`, pipes and log files. */
export function bannerPlain(s: BannerStats): string[] {
  return bannerRows(s).map(plainOf);
}

/** The banner with ANSI colour, one reset per segment so nothing bleeds. */
export function bannerAnsi(s: BannerStats): string[] {
  return bannerRows(s).map((segs) =>
    segs.map(([text, tone]) => `${ANSI[tone]}${text}${RESET}`).join(""),
  );
}
