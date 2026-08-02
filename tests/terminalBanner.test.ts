import { describe, it, expect } from "vitest";
import { bannerRows, bannerPlain, bannerAnsi, bannerWidth, BANNER_MIN_WIDTH } from "@/lib/brand/banner";
import { BRAND, LOGO_ASCII } from "@/lib/brand/logo";

const STATS = { version: "9.9.9", identifiers: 5, modes: 8, sources: 21, freeSources: 13 };

describe("terminal banner", () => {
  it("frames the mark and the text at a fixed width", () => {
    const rows = bannerPlain(STATS);
    expect(rows).toHaveLength(LOGO_ASCII.length + 2); // the mark, plus two rules
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

  it("states the version, the tagline and the keyless-source ratio", () => {
    const text = bannerPlain(STATS).join("\n");
    expect(text).toContain("HEAVEN-GeoIntel");
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
    // A four-digit source count is a reason for a bigger box, not for a
    // truncated number or a broken right border.
    const wide = { ...STATS, version: "10.20.30-rc.1", sources: 9999, freeSources: 8888 };
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
