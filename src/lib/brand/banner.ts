/**
 * HEAVEN-GeoIntel — the terminal poster.
 *
 * The same identity as the README poster, redrawn for the one surface where a
 * user meets this tool before any browser is involved: the shell. It heads
 * `scripts/start.sh`, `install-global.sh` and `uninstall-global.sh`.
 *
 * The composition is a centred crest. The hexagon-and-globe monogram leads,
 * then the full product name is set as a two-line block logotype, HEAVEN over
 * GEOINTEL, in a shadowed 3D face so the launcher opens on the whole name
 * rather than the first word of it. Under the logotype sit the tagline, a rule,
 * the four verbs of the workflow, the live stats, the version and its pipeline,
 * and finally the owner's credit. Everything is centred inside one framed box.
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

import { BRAND, LOGO_ASCII } from "./logo";

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
  dim: "\u001b[38;5;66m",     // the stat + pipeline lines
  accent: "\u001b[38;5;44m",  // version, verbs and separators
};

const RESET = "\u001b[0m";

/**
 * Narrowest the frame is allowed to be, in columns. Every glyph used here —
 * box-drawing, the block-shadow font, `·`, `◇` — is exactly one column wide.
 * The GEOINTEL line of the logotype is a fixed 64 columns, the widest thing in
 * the box, so with the side padding below this floor is what the frame settles
 * on for every realistic set of stats; a genuinely oversized field (a long
 * pre-release version, an absurd source count) grows it rather than being
 * clipped.
 */
export const BANNER_MIN_WIDTH = 70;

/** Columns of breathing room kept either side of the longest centred line. */
const SIDE_PAD = 3;

/** The owner's credit, the line the launcher signs off with. */
const OWNER = "Nisarg Chasmawala (Shroff)";

/** The rule under the tagline — a fixed length, centred like everything else. */
const RULE = "─".repeat(46);

type Seg = readonly [text: string, tone: Tone];

/**
 * A shadowed 3D block alphabet (the "ANSI Shadow" face), only the letters the
 * two-line logotype needs. Each glyph is six rows tall and a fixed width, with
 * the bright `█` face and the `╗╝╔╚═║` bevel that reads as an extruded edge.
 * Every row of a glyph is padded to a rectangle so composed words stay on the
 * same monospace grid the frame is measured against.
 */
const SHADOW_FONT: Record<string, readonly string[]> = {
  H: ["██╗  ██╗", "██║  ██║", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  V: ["██╗   ██╗", "██║   ██║", "██║   ██║", "╚██╗ ██╔╝", " ╚████╔╝ ", "  ╚═══╝  "],
  N: ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"],
  G: [" ██████╗ ", "██╔════╝ ", "██║  ███╗", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
  T: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
  L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
};

/** The `█` face of a glyph; every other cell is bevel (or padding). */
const FACE = "█";

/** Set a word in the 3D face: concatenated glyphs, one shared six-row grid. */
const blockWord = (word: string): readonly string[] =>
  Array.from({ length: 6 }, (_, r) => [...word].map((ch) => SHADOW_FONT[ch][r]).join(""));

/** The two lines of the logotype, HEAVEN over GEOINTEL, both in the 3D face. */
export const HEAVEN_ASCII: readonly string[] = blockWord("HEAVEN");
export const GEOINTEL_ASCII: readonly string[] = blockWord("GEOINTEL");

const blank: readonly Seg[] = [];

/**
 * The banner's content, top to bottom, as rows of tone-tagged segments and
 * before any centring or framing. The monogram leads (its five rows carry the
 * `mark` tone the gradient reads as the vertical green→cyan ramp), then the two
 * lines of the block logotype, the tagline, a rule, the workflow verbs, the
 * live stats, the version with its pipeline, and the owner's credit.
 */
function contentRows(s: BannerStats): (readonly Seg[])[] {
  const stat = `${s.identifiers} identifiers · ${s.modes} modes · ${s.freeSources}/${s.sources} sources need no key`;
  return [
    ...LOGO_ASCII.map((line): readonly Seg[] => [[line, "mark"]]),
    blank,
    ...HEAVEN_ASCII.map((line): readonly Seg[] => [[line, "word"]]),
    ...GEOINTEL_ASCII.map((line): readonly Seg[] => [[line, "word"]]),
    blank,
    [
      ["◇  ", "accent"],
      [BRAND.tagline.toUpperCase(), "tag"],
      ["  ◇", "accent"],
    ],
    [[RULE, "frame"]],
    [["Search It.  Enrich It.  Pivot It.  Report It.", "accent"]],
    blank,
    [[stat, "dim"]],
    [
      [`v${s.version}`, "accent"],
      ["  ·  ", "frame"],
      ["Lookup -> Enrich -> Pivot -> Report", "dim"],
    ],
    blank,
    [
      ["Owned & Developed by  ", "dim"],
      [OWNER, "mark"],
    ],
  ];
}

const plainOf = (segs: readonly Seg[]): string => segs.map(([t]) => t).join("");
const widthOf = (segs: readonly Seg[]): number => [...plainOf(segs)].length;

/**
 * The interior width of the frame. It grows to fit rather than clamping: an
 * unusually long field is a reason for a wider box, never a reason to truncate
 * it or to let a line push through the right border. In practice the GEOINTEL
 * logotype line is the widest thing in the box, so `BANNER_MIN_WIDTH` is what
 * the frame settles on.
 */
export function bannerWidth(s: BannerStats): number {
  const longest = Math.max(...contentRows(s).map(widthOf));
  return Math.max(BANNER_MIN_WIDTH, longest + SIDE_PAD * 2);
}

/**
 * Compose the framed banner as rows of coloured segments, every content row
 * centred within the interior width.
 *
 * Padding is computed from the *plain* text, never the coloured string — an
 * ANSI escape occupies zero columns but plenty of bytes, and padding on byte
 * length is the classic way to produce a box that doesn't line up.
 */
export function bannerRows(s: BannerStats): (readonly Seg[])[] {
  const width = bannerWidth(s);
  const rule = "─".repeat(width);
  const out: (readonly Seg[])[] = [[[`╭${rule}╮`, "frame"]]];

  for (const row of contentRows(s)) {
    const left = Math.floor((width - widthOf(row)) / 2);
    const right = width - widthOf(row) - left;
    out.push([
      ["│", "frame"],
      [" ".repeat(left), "frame"],
      ...row,
      [" ".repeat(right), "frame"],
      ["│", "frame"],
    ]);
  }

  out.push([[`╰${rule}╯`, "frame"]]);
  return out;
}

/** The banner with no escape codes — for `NO_COLOR`, pipes and log files. */
export function bannerPlain(s: BannerStats): string[] {
  return bannerRows(s).map(plainOf);
}

/** The banner with 256-colour ANSI, one reset per segment so nothing bleeds. */
export function bannerAnsi(s: BannerStats): string[] {
  return bannerRows(s).map((segs) =>
    segs.map(([text, tone]) => `${ANSI[tone]}${text}${RESET}`).join(""),
  );
}

// ── 24-bit colour ────────────────────────────────────────────────────────────
// A richer tier for terminals that advertise COLORTERM=truecolor (iTerm2, the
// VS Code terminal, kitty, Alacritty, most modern emulators). Flat 256-colour
// cannot draw a smooth ramp, so its frame is a solid cyan rule and its logotype
// a solid bold green; here the frame becomes a cyan→green→cyan sweep, the mark
// takes the same vertical green→cyan gradient the SVG logo already uses, and
// each logotype line glows across one green→cyan run with its bevel dropped to
// a dark shade so the 3D face reads as extruded. hv_banner picks this only when
// the terminal says it can render it, else bannerAnsi() or bannerPlain().
type Rgb = readonly [number, number, number];

const hexToRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

/** Brand stops, plus the two muted tones the 256-colour tier renders as 108/66. */
const GREEN = hexToRgb(BRAND.green); //  #00ff85, the monogram
const CYAN = hexToRgb(BRAND.cyan); //    #22d3ee, the globe and frame
const SAGE: Rgb = [127, 174, 147]; //    the tagline
const SLATE: Rgb = [95, 137, 122]; //    the stat + pipeline lines, a greyer sage

const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** Drop a face colour to its extruded-edge shade — same hue, much darker. */
const bevel = (c: Rgb): Rgb => [Math.round(c[0] * 0.42), Math.round(c[1] * 0.42), Math.round(c[2] * 0.42)];
/** A 0→1→0 ramp, so a left-to-right frame sweep is cyan at both borders. */
const triangle = (p: number): number => 1 - Math.abs(p * 2 - 1);
/** "ESC[" reused from RESET, so this module never spells an escape byte twice. */
const CSI = RESET.slice(0, 2);

/**
 * The banner in 24-bit colour. Same layout and text as bannerPlain(), painted
 * as a gradient. Adjacent cells of one colour are grouped into a run, so one
 * escape opens the run and one reset closes it: the visible width matches the
 * plain rows exactly and nothing bleeds past a row's end.
 *
 * bannerWidth() never drops below BANNER_MIN_WIDTH and LOGO_ASCII is a fixed
 * five-row mark, so every divisor below is a constant greater than zero: the
 * gradient carries no defensive branch the real banner would never take.
 */
export function bannerTrueColor(s: BannerStats): string[] {
  const rows = bannerRows(s);
  const span = bannerWidth(s) + 1; // index of the last column, both borders in
  const markSpan = LOGO_ASCII.length - 1; // index of the last mark row

  return rows.map((segs, rowIndex) => {
    // Every "word" cell on a row shares one green→cyan run, so the gradient
    // sweeps across that row's logotype line as a single form. The extent is
    // the min/max column of the word cells, tracked without a branch so a row
    // with no logotype carries no dead defensive path.
    let wordStart = span;
    let wordEnd = 0;
    let scan = 0;
    for (const [text, tone] of segs) {
      const len = [...text].length;
      if (tone === "word") {
        wordStart = Math.min(wordStart, scan);
        wordEnd = Math.max(wordEnd, scan + len - 1);
      }
      scan += len;
    }
    // The monogram rows (1 … LOGO_ASCII.length) carry the SVG's vertical
    // green→cyan ramp; any other "mark" cell (the owner's name) is solid green.
    const markRgb =
      rowIndex >= 1 && rowIndex <= LOGO_ASCII.length ? mix(GREEN, CYAN, (rowIndex - 1) / markSpan) : GREEN;

    const cells: { ch: string; key: string }[] = [];
    let col = 0;
    for (const [text, tone] of segs) {
      for (const ch of [...text]) {
        let rgb: Rgb;
        switch (tone) {
          case "frame":
            rgb = mix(CYAN, GREEN, triangle(col / span));
            break;
          case "mark":
            rgb = markRgb;
            break;
          case "word": {
            // The face glows across the green→cyan run; the bevel drops to a
            // dark shade of the same colour, which is what makes it read as 3D.
            const lit = mix(GREEN, CYAN, (col - wordStart) / Math.max(1, wordEnd - wordStart));
            rgb = ch === FACE ? lit : bevel(lit);
            break;
          }
          case "tag":
            rgb = SAGE;
            break;
          case "accent":
            rgb = CYAN;
            break;
          default:
            rgb = SLATE; // "dim"
        }
        cells.push({ ch, key: `${rgb[0]};${rgb[1]};${rgb[2]}` });
        col += 1;
      }
    }

    let out = "";
    let i = 0;
    while (i < cells.length) {
      const { key } = cells[i];
      let run = "";
      while (i < cells.length && cells[i].key === key) {
        run += cells[i].ch;
        i += 1;
      }
      out += `${CSI}38;2;${key}m${run}${RESET}`;
    }
    return out;
  });
}
