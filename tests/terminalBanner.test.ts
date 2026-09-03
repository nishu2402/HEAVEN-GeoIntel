import { describe, it, expect } from "vitest";
import {
  bannerRows,
  bannerPlain,
  bannerAnsi,
  bannerTrueColor,
  bannerWidth,
  BANNER_MIN_WIDTH,
  HEAVEN_ASCII,
  GEOINTEL_ASCII,
} from "@/lib/brand/banner";
import { BRAND, LOGO_ASCII } from "@/lib/brand/logo";

const STATS = { version: "9.9.9", identifiers: 5, modes: 8, sources: 21, freeSources: 13 };

describe("terminal banner", () => {
  it("frames the crest and the text at a fixed width", () => {
    const rows = bannerPlain(STATS);
    // A centred crest: the five-row monogram over the two-line block logotype
    // (HEAVEN over GEOINTEL, six rows each), then the tagline, a rule, the
    // verbs, the stats, the version pipeline and the owner's credit (with blank
    // spacers between the blocks), all wrapped in the top and bottom rules.
    expect(rows).toHaveLength(LOGO_ASCII.length + HEAVEN_ASCII.length + GEOINTEL_ASCII.length + 12);
    expect(rows[0]).toBe(`╭${"─".repeat(bannerWidth(STATS))}╮`);
    expect(rows.at(-1)).toBe(`╰${"─".repeat(bannerWidth(STATS))}╯`);
  });

  it("pads on VISIBLE width, so colour never breaks the box", () => {
    // An ANSI escape is several bytes and zero columns. Padding on string
    // length is the classic way to produce a box that doesn't line up, so the
    // coloured rows must measure the same as the plain ones.
    const plain = bannerPlain(STATS);
    const ansi = bannerAnsi(STATS);
    const visible = (s: string) => [...s.replace(/\u001b\[[0-9;]*m/g, "")].length;
    expect(ansi.map(visible)).toEqual(plain.map((r) => [...r].length));
    expect(new Set(plain.map((r) => [...r].length))).toEqual(new Set([bannerWidth(STATS) + 2]));
  });

  it("carries the mark verbatim from the shared geometry", () => {
    const rows = bannerPlain(STATS);
    for (const [i, art] of LOGO_ASCII.entries()) expect(rows[i + 1]).toContain(art);
  });

  it("sets HEAVEN-GeoIntel as a two-line block logotype and states the version, tagline and ratio", () => {
    const text = bannerPlain(STATS).join("\n");
    // The full name is the logotype now: HEAVEN over GEOINTEL, every row of both.
    for (const row of HEAVEN_ASCII) expect(text).toContain(row);
    for (const row of GEOINTEL_ASCII) expect(text).toContain(row);
    expect(text).toContain("v9.9.9");
    expect(text).toContain(BRAND.tagline.toUpperCase());
    expect(text).toContain("5 identifiers · 8 modes · 13/21 sources need no key");
  });

  it("resets colour after every segment so nothing bleeds into the shell", () => {
    for (const row of bannerAnsi(STATS)) {
      expect(row.endsWith("\u001b[0m")).toBe(true);
      // Every escape that opens a colour is matched by a reset.
      const opens = row.match(/\u001b\[(?!0m)[0-9;]*m/g) ?? [];
      const resets = row.match(/\u001b\[0m/g) ?? [];
      expect(resets).toHaveLength(opens.length);
    }
  });

  it("emits no escape codes at all in the plain rendering", () => {
    expect(bannerPlain(STATS).join("")).not.toContain("\u001b");
  });

  it("widens the frame rather than letting a long line push through it", () => {
    // A source count in the billions is a reason for a bigger box, not for a
    // truncated number or a broken right border. (The logotype line already
    // sets a wide floor, so it takes an absurd stat to grow past it.)
    const wide = { ...STATS, version: "1.0.0", sources: 10 ** 12, freeSources: 10 ** 12 };
    const widths = new Set(bannerPlain(wide).map((r) => [...r].length));
    expect(widths.size).toBe(1);
    expect(bannerWidth(wide)).toBeGreaterThan(BANNER_MIN_WIDTH);
    // …and a short one still gets the minimum, so the box never looks cramped.
    expect(bannerWidth({ ...STATS, version: "1.0.0", sources: 1, freeSources: 1 })).toBe(BANNER_MIN_WIDTH);
  });

  it("exposes rows as tone-tagged segments, not pre-coloured strings", () => {
    // Keeping the colour decision out of the layout is what lets the same rows
    // render to a TTY, to a pipe, and (in principle) anywhere else.
    const rows = bannerRows(STATS);
    const tones = new Set(rows.flat().map(([, tone]) => tone));
    expect(tones.has("frame")).toBe(true);
    expect(tones.has("mark")).toBe(true);
    expect(tones.has("word")).toBe(true);
  });
});

describe("terminal banner, 24-bit colour tier", () => {
  // Built without a single escape literal in the source: ESC comes from a
  // char code and the patterns are plain substrings, so this file is safe to
  // edit with tools that rewrite backslash sequences.
  const ESC = String.fromCharCode(27);
  const RESET = ESC + "[0m";
  const OPEN = ESC + "[38;2;";

  const strip = (s: string): string => {
    let out = "";
    for (let i = 0; i < s.length; ) {
      if (s[i] === ESC) {
        while (i < s.length && s[i] !== "m") i += 1;
        i += 1;
      } else {
        out += s[i];
        i += 1;
      }
    }
    return out;
  };
  const count = (s: string, sub: string): number => s.split(sub).length - 1;

  it("strips back to exactly the plain rows, so colour never shifts the layout", () => {
    // The whole point of grouping colour runs: remove the escapes and the box,
    // the mark and the text are byte-for-byte the plain rendering.
    expect(bannerTrueColor(STATS).map(strip)).toEqual(bannerPlain(STATS));
  });

  it("paints with real 24-bit escapes and the brand's own stops", () => {
    const joined = bannerTrueColor(STATS).join("");
    expect(joined).toContain(OPEN);
    expect(joined).toContain(ESC + "[38;2;0;255;133m"); // #00ff85, the green stop
    expect(joined).toContain(ESC + "[38;2;34;211;238m"); // #22d3ee, the cyan stop
  });

  it("opens and closes every colour run, so nothing bleeds into the shell", () => {
    for (const row of bannerTrueColor(STATS)) {
      expect(row.endsWith(RESET)).toBe(true);
      expect(count(row, RESET)).toBe(count(row, OPEN));
    }
  });
});
