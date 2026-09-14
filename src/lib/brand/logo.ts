/**
 * HEAVEN-GeoIntel — brand mark.
 *
 * Single source of truth for the logo. Every surface (web header, favicon,
 * OG image, HTML reports, printable case reports, plain-text reports) is
 * generated from the geometry and colours below, so the mark can never drift
 * between the app and its exports.
 *
 * ── Construction ──────────────────────────────────────────────────────────
 * A pointy-top hexagon (the defensive-security seal) frames a wireframe globe
 * (Geo). The "H" of HEAVEN is not drawn on top of the globe — its two stems
 * are *chords* of the globe, so their endpoints land exactly on the sphere,
 * and its crossbar is the equator. A single orbit ring, tilted 20°, crosses
 * the sphere behind the monogram (Intel). Nothing in the mark is arbitrary:
 * every coordinate below is derived from the hexagon's circumradius (30) and
 * the globe's radius (16).
 */

export const BRAND = {
  name: "HEAVEN-GeoIntel",
  tagline: "Unified OSINT Platform",
  /** Primary neon — the monogram. Matches --hv-green. */
  green: "#00ff85",
  /** Secondary neon — the globe and orbit. Matches --hv-cyan. */
  cyan: "#22d3ee",
  /** Single-colour ink for print/light surfaces. */
  ink: "#0b1020",
  /**
   * The mark's own colours, re-mixed for white paper.
   *
   * The neon pair is tuned for a near-black screen: on a sheet of paper #00ff85
   * measures barely 1.4:1 against white and a 3.5pt hexagon drawn in it all but
   * disappears, which is why the printed documents used to fall back to one flat
   * ink. These keep the same two hues and the same green-to-cyan direction, at
   * 4.2:1 and 5.4:1 against white, so the printed mark is the brand's mark in
   * colour rather than a silhouette of it.
   */
  greenInk: "#008f4c",
  cyanInk: "#0e7490",
} as const;

/**
 * Mark geometry, in the 64×64 user space of the SVG viewBox.
 *
 * `stemChord` = √(globeR² − stemGap²) — the half-height of a vertical chord
 * drawn `stemGap` from the centre of a circle of radius `globeR`. That is what
 * makes the H land exactly on the sphere rather than merely overlapping it.
 */
export const LOGO = {
  viewBox: "0 0 64 64",
  /** Pointy-top hexagon, circumradius 30 about (32,32). */
  hexPath: "M32 2 L57.98 17 L57.98 47 L32 62 L6.02 47 L6.02 17 Z",
  hexStroke: 3.5,
  globeR: 16,
  globeStroke: 1.7,
  /** Orbit ring: same major radius as the globe, tilted so it reads as depth. */
  orbitRy: 5.6,
  orbitTilt: -20,
  /** Monogram: stems at 32±9, ends at 32±√(16²−9²). */
  hPath: "M23 18.77 V45.23 M41 18.77 V45.23 M23 32 H41",
  hStroke: 5.6,
  /** The globe reads as the solid form; the orbit sits behind it. */
  globeOpacity: 0.95,
  orbitOpacity: 0.62,
} as const;

export interface LogoSvgOptions {
  /** Rendered square size in px. Default 64. */
  size?: number;
  /** Render every stroke in this one colour (favicons, stamps, watermarks). */
  mono?: string;
  /**
   * Draw the mark in the paper palette: the same two hues, darkened to hold
   * their contrast on white. For the printed documents, which want a colour
   * mark that still survives a monochrome laser printer.
   */
  paper?: boolean;
  /** Prefix for the gradient id, so several inlined marks never collide. */
  idPrefix?: string;
  /** Accessible label. Omitted → the mark is exposed as decorative. */
  title?: string;
}

const escAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The mark as a standalone SVG string, for contexts with no React: the
 * `icon.svg` asset, exported HTML reports, and printable case reports.
 */
export function logoSvg(options: LogoSvgOptions = {}): string {
  const { size = 64, mono, paper, idPrefix = "hv", title } = options;
  const gradId = `${idPrefix}-frame`;

  // Mono collapses the palette to one ink; otherwise the frame carries the
  // green→cyan gradient and the globe stays cyan against the green monogram.
  // `paper` swaps in the darker renderings of those same two hues.
  const green = paper ? BRAND.greenInk : BRAND.green;
  const cyan = paper ? BRAND.cyanInk : BRAND.cyan;
  const frameStroke = mono ?? `url(#${gradId})`;
  const globeStroke = mono ?? cyan;
  const markStroke = mono ?? green;

  const defs = mono
    ? ""
    : `<defs><linearGradient id="${gradId}" x1="32" y1="2" x2="32" y2="62" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="${green}"/><stop offset="1" stop-color="${cyan}"/>` +
      `</linearGradient></defs>`;

  const a11y = title ? `role="img" aria-label="${escAttr(title)}"` : `aria-hidden="true" focusable="false"`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO.viewBox}" width="${size}" height="${size}" fill="none" ${a11y}>` +
    defs +
    `<path d="${LOGO.hexPath}" stroke="${frameStroke}" stroke-width="${LOGO.hexStroke}" stroke-linejoin="round"/>` +
    `<circle cx="32" cy="32" r="${LOGO.globeR}" stroke="${globeStroke}" stroke-width="${LOGO.globeStroke}" opacity="${LOGO.globeOpacity}"/>` +
    `<ellipse cx="32" cy="32" rx="${LOGO.globeR}" ry="${LOGO.orbitRy}" stroke="${globeStroke}" stroke-width="${LOGO.globeStroke}" opacity="${LOGO.orbitOpacity}" transform="rotate(${LOGO.orbitTilt} 32 32)"/>` +
    `<path d="${LOGO.hPath}" stroke="${markStroke}" stroke-width="${LOGO.hStroke}" stroke-linecap="square"/>` +
    `</svg>`
  );
}

/**
 * The same hexagon-and-monogram construction reduced to a 9-column monospace
 * glyph, so plain-text reports carry the identity too. Every row is exactly
 * `LOGO_ASCII_WIDTH` columns, which is what keeps `asciiLetterhead` aligned.
 */
export const LOGO_ASCII: readonly string[] = [
  " ▄▀▀▀▀▀▄ ",
  "▐  █ █  ▌",
  "▐  ███  ▌",
  "▐  █ █  ▌",
  " ▀▄▄▄▄▄▀ ",
];

export const LOGO_ASCII_WIDTH = 9;

/**
 * Compose the ASCII mark with a block of text to its right — the letterhead
 * at the top of every plain-text export. Text longer than the mark keeps its
 * indent; a mark taller than the text simply finishes on its own.
 */
export function asciiLetterhead(lines: readonly string[]): string {
  const gutter = "    ";
  const blank = " ".repeat(LOGO_ASCII_WIDTH);
  const rows = Math.max(LOGO_ASCII.length, lines.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const mark = LOGO_ASCII[i] ?? blank;
    const text = lines[i] ?? "";
    out.push((mark + gutter + text).trimEnd());
  }
  return out.join("\n");
}
