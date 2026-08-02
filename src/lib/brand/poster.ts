/**
 * HEAVEN-GeoIntel — the poster.
 *
 * A self-contained, animated SVG banner built from the same geometry module the
 * app's header, favicon and report letterheads use, so the poster can never
 * show a different mark from the product.
 *
 * Everything it *claims* is passed in as `PosterStats`, and the generator
 * (`scripts/generate-brand-assets.mjs`) derives those numbers by reading the
 * real source of truth — the version module, the source manifest, the endpoint
 * registry, the username catalog. A poster that advertises "21 sources" when
 * the manifest holds 19 is exactly the kind of confident wrong number this
 * project refuses to print anywhere else, so it isn't allowed here either.
 *
 * Constraints that shaped the output:
 *   • **No external references.** GitHub proxies README images through camo and
 *     will not fetch a webfont, a CSS file or a nested image from inside an
 *     SVG. Fonts are generic families, animation is inline CSS, and the whole
 *     poster is one file.
 *   • **The still frame has to work.** If a renderer strips the animation, what
 *     is left must still be a finished poster — so nothing important starts at
 *     `opacity: 0` and animates in. Motion is decoration only.
 *   • **Reduced motion is honoured**, because a looping scan line is exactly
 *     the sort of thing that hurts to look at for some readers.
 */

import { BRAND, LOGO } from "./logo";

export interface PosterStats {
  /** Full semver, rendered in the version pill. */
  version: string;
  /** Identifier types the tool accepts (phone, email, username, IP, domain). */
  identifiers: number;
  /** Workspace modes, including the non-lookup ones (bulk, graph, cases). */
  modes: number;
  /** Total upstream sources in the manifest. */
  sources: number;
  /** How many of those need no API key — the out-of-the-box number. */
  freeSources: number;
  /** Sites in the bundled username catalog. */
  usernameSites: number;
  /** How many of those are auto-verified server-side (the rest are manual). */
  autoVerified: number;
  /** Documented API operations. */
  apiOperations: number;
  /** Coverage threshold the build gate enforces, as a percentage. */
  coverage: number;
}

export type PosterTheme = "dark" | "light";

export interface PosterOptions {
  theme?: PosterTheme;
  /** Set false for a still frame (print, or a renderer that strips CSS). */
  animated?: boolean;
  width?: number;
}

interface Palette {
  bg: string;
  bgTo: string;
  grid: string;
  ink: string;
  dim: string;
  faint: string;
  green: string;
  cyan: string;
  glow: number;
}

const PALETTES: Record<PosterTheme, Palette> = {
  dark: {
    bg: "#0d1730",
    bgTo: "#05060d",
    grid: "rgba(0,255,133,.055)",
    ink: "#e8fff5",
    dim: "#7fae93",
    faint: "#3f6b57",
    green: BRAND.green,
    cyan: BRAND.cyan,
    glow: 0.16,
  },
  light: {
    // Not an inversion: the neons are dropped to shades that actually pass on
    // paper-white, because #00ff85 on #ffffff is unreadable.
    bg: "#ffffff",
    bgTo: "#eef4f1",
    grid: "rgba(0,90,60,.07)",
    ink: "#0b1020",
    dim: "#456b5c",
    faint: "#9ab3a8",
    green: "#00a862",
    cyan: "#0e7490",
    glow: 0.1,
  },
};

const FONT = "ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,DejaVu Sans Mono,monospace";

const W = 1280;
const H = 480;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The five identifier prompts that cycle in the terminal line. */
const PROMPTS = ["+1 415 555 2671", "target@domain.com", "@handle", "8.8.8.8", "example.com"];

/**
 * The mark, re-drawn at poster scale from the same `LOGO` geometry as
 * everything else. Not `logoSvg()` — a nested `<svg>` cannot be animated by the
 * parent's stylesheet, and the orbit ring needs to spin.
 */
function mark(p: Palette, cx: number, cy: number, size: number, animated: boolean): string {
  const scale = size / 64;
  const spin = animated ? ' class="orbit"' : "";
  return (
    `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-32 -32)" fill="none">` +
    `<path d="${LOGO.hexPath}" stroke="url(#frame)" stroke-width="${LOGO.hexStroke}" stroke-linejoin="round"/>` +
    `<circle cx="32" cy="32" r="${LOGO.globeR}" stroke="${p.cyan}" stroke-width="${LOGO.globeStroke}" opacity="${LOGO.globeOpacity}"/>` +
    `<g${spin} style="transform-origin:32px 32px">` +
    `<ellipse cx="32" cy="32" rx="${LOGO.globeR}" ry="${LOGO.orbitRy}" stroke="${p.cyan}" stroke-width="${LOGO.globeStroke}" opacity="${LOGO.orbitOpacity}" transform="rotate(${LOGO.orbitTilt} 32 32)"/>` +
    `</g>` +
    `<path d="${LOGO.hPath}" stroke="${p.green}" stroke-width="${LOGO.hStroke}" stroke-linecap="square"/>` +
    `</g>`
  );
}

/** Corner brackets — the app's panel chrome, at poster scale. */
function brackets(p: Palette): string {
  const m = 26;
  const l = 46;
  const corner = (x: number, y: number, dx: number, dy: number) =>
    `<path d="M${x + dx * l} ${y} H${x} V${y + dy * l}" stroke="${p.faint}" stroke-width="2" fill="none"/>`;
  return (
    corner(m, m, 1, 1) +
    corner(W - m, m, -1, 1) +
    corner(m, H - m, 1, -1) +
    corner(W - m, H - m, -1, -1)
  );
}

function stats(p: Palette, s: PosterStats): string {
  // Labels are kept short enough to fit their column at this letter-spacing:
  // "SOURCES NEED NO KEY" measured wider than the 180px cell and collided with
  // its neighbour, which is the sort of thing only rendering the file shows you.
  const cells: [string, string][] = [
    [`${s.identifiers}`, "IDENTIFIERS"],
    [`${s.modes}`, "MODES"],
    [`${s.freeSources}/${s.sources}`, "KEYLESS SOURCES"],
    [`${s.autoVerified}/${s.usernameSites}`, "AUTO-VERIFIED"],
    [`${s.apiOperations}`, "API OPS"],
    [`${s.coverage}%`, "COVERAGE"],
  ];
  const y = 392;
  const step = (W - 200) / cells.length;
  return cells
    .map(([value, label], i) => {
      const x = 100 + step * i + step / 2;
      const rule =
        i === 0
          ? ""
          : `<line x1="${x - step / 2}" y1="${y - 26}" x2="${x - step / 2}" y2="${y + 20}" stroke="${p.faint}" stroke-width="1" opacity=".55"/>`;
      return (
        rule +
        `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="${p.green}">${esc(value)}</text>` +
        `<text x="${x}" y="${y + 22}" text-anchor="middle" font-family="${FONT}" font-size="12" letter-spacing="2" fill="${p.dim}">${esc(label)}</text>`
      );
    })
    .join("");
}

/**
 * The cycling prompt line. Each entry holds the frame, so the still image shows
 * the first one rather than an empty row.
 */
function terminal(p: Palette, animated: boolean): string {
  const x = 372;
  const y = 300;
  const dur = PROMPTS.length * 2.2;
  const lines = PROMPTS.map((t, i) => {
    const anim = animated
      ? ` style="animation:cycle ${dur}s steps(1,end) infinite;animation-delay:${(i * dur) / PROMPTS.length}s"`
      : "";
    // Without animation only the first prompt is drawn; with it, every line
    // starts hidden except the one whose turn it is.
    const base = i === 0 ? "1" : "0";
    return animated || i === 0
      ? `<text x="${x + 26}" y="${y}" font-family="${FONT}" font-size="26" fill="${p.cyan}" opacity="${base}"${anim}>${esc(t)}</text>`
      : "";
  }).join("");

  const caret = animated
    ? `<rect x="${x + 4}" y="${y - 20}" width="13" height="26" fill="${p.green}" style="animation:blink 1.06s steps(1,end) infinite"/>`
    : `<rect x="${x + 4}" y="${y - 20}" width="13" height="26" fill="${p.green}" opacity=".8"/>`;

  return (
    `<text x="${x - 26}" y="${y}" font-family="${FONT}" font-size="26" font-weight="700" fill="${p.green}">&gt;</text>` +
    caret +
    lines
  );
}

/** The stylesheet. Empty when the poster is a still. */
function styles(animated: boolean): string {
  if (!animated) return "";
  return (
    `<style>` +
    `@keyframes sweep{0%{transform:translateX(-30%)}100%{transform:translateX(130%)}}` +
    `@keyframes blink{0%,50%{opacity:1}50.01%,100%{opacity:0}}` +
    `@keyframes cycle{0%{opacity:1}20%{opacity:1}20.01%{opacity:0}100%{opacity:0}}` +
    `@keyframes orbit{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}` +
    `@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}` +
    `.scan{animation:sweep 6.5s linear infinite}` +
    `.orbit{animation:orbit 14s linear infinite}` +
    `.pulse{animation:pulse 3.4s ease-in-out infinite}` +
    // A looping scan line is precisely what reduced-motion asks us to stop.
    `@media(prefers-reduced-motion:reduce){.scan,.orbit,.pulse,text,rect{animation:none!important}}` +
    `</style>`
  );
}

/**
 * Render the poster.
 *
 * The result is a complete `<svg>` document string — write it to a `.svg` file
 * and it works in a README, a browser tab or a slide.
 */
export function posterSvg(s: PosterStats, options: PosterOptions = {}): string {
  const { theme = "dark", animated = true, width = W } = options;
  const p = PALETTES[theme];
  const height = Math.round((width * H) / W);
  const label = `${BRAND.name} — ${BRAND.tagline}, v${s.version}`;

  const scan = animated
    ? `<g class="scan"><rect x="0" y="0" width="180" height="${H}" fill="url(#scan)"/></g>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${width}" height="${height}" ` +
    `role="img" aria-label="${esc(label)}" font-family="${FONT}">` +
    styles(animated) +
    `<defs>` +
    `<linearGradient id="frame" x1="32" y1="2" x2="32" y2="62" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${p.green}"/><stop offset="1" stop-color="${p.cyan}"/></linearGradient>` +
    `<linearGradient id="word" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${p.green}"/><stop offset="1" stop-color="${p.cyan}"/></linearGradient>` +
    `<linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${p.green}" stop-opacity="0"/><stop offset=".28" stop-color="${p.green}"/>` +
    `<stop offset=".72" stop-color="${p.cyan}"/><stop offset="1" stop-color="${p.cyan}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="scan" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${p.green}" stop-opacity="0"/><stop offset=".5" stop-color="${p.green}" stop-opacity=".07"/>` +
    `<stop offset="1" stop-color="${p.green}" stop-opacity="0"/></linearGradient>` +
    `<radialGradient id="halo" cx=".5" cy=".5" r=".5">` +
    `<stop offset="0" stop-color="${p.green}" stop-opacity="${p.glow}"/><stop offset="1" stop-color="${p.green}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="bg" cx=".5" cy="0" r="1.1">` +
    `<stop offset="0" stop-color="${p.bg}"/><stop offset=".62" stop-color="${p.bgTo}"/></radialGradient>` +
    `<pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">` +
    `<path d="M44 0H0V44" fill="none" stroke="${p.grid}" stroke-width="1"/></pattern>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#grid)"/>` +
    `<ellipse cx="196" cy="210" rx="330" ry="260" fill="url(#halo)"/>` +
    scan +
    `<rect x="0" y="0" width="${W}" height="3" fill="url(#rule)"/>` +
    brackets(p) +
    mark(p, 196, 200, 240, animated) +
    // Wordmark. Two tspans so "HEAVEN" stays solid neon and "GeoIntel" carries
    // the gradient, exactly as the app header renders it.
    `<text x="372" y="196" font-size="82" font-weight="700" letter-spacing="2">` +
    `<tspan fill="${p.green}">HEAVEN</tspan><tspan fill="${p.faint}">-</tspan><tspan fill="url(#word)">GeoIntel</tspan>` +
    `</text>` +
    `<text x="374" y="240" font-size="20" letter-spacing="9.5" fill="${p.dim}">${esc(BRAND.tagline.toUpperCase())}</text>` +
    // Version pill, parked in the top-right rather than beside the wordmark:
    // at 82px "HEAVEN-GeoIntel" reaches x≈1110 and ran straight through a pill
    // level with its baseline.
    `<g${animated ? ' class="pulse"' : ""}>` +
    `<rect x="${W - 210}" y="56" width="126" height="40" rx="20" fill="none" stroke="${p.green}" stroke-width="1.6" opacity=".8"/>` +
    `<text x="${W - 147}" y="83" text-anchor="middle" font-size="21" font-weight="700" letter-spacing="1.5" fill="${p.green}">v${esc(s.version)}</text>` +
    `</g>` +
    terminal(p, animated) +
    `<line x1="100" y1="342" x2="${W - 100}" y2="342" stroke="${p.faint}" stroke-width="1" opacity=".5"/>` +
    stats(p, s) +
    `<text x="${W / 2}" y="452" text-anchor="middle" font-size="13" letter-spacing="3.4" fill="${p.faint}">` +
    `PUBLICLY-DERIVABLE METADATA ONLY · NO REAL-TIME LOCATION · NO DEVICE TRACKING</text>` +
    `</svg>`
  );
}
