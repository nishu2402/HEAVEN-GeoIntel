// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { BRAND, LOGO, LOGO_ASCII, LOGO_ASCII_WIDTH, logoSvg, asciiLetterhead } from "@/lib/brand/logo";
import Logo, { LogoLockup } from "@/components/shared/Logo";

// The mark is generated from one geometry module and rendered three ways: as a
// React element in the app, as an SVG string in HTML exports, and as monospace
// art in plain-text exports. These tests pin the construction that makes the
// monogram sit *on* the globe, and cover both colour modes of each renderer.

afterEach(cleanup);

describe("logo geometry", () => {
  it("places the H's stems as exact chords of the globe", () => {
    // Stems at 32±9 must terminate at 32±√(globeR² − 9²), so their endpoints
    // land on the sphere instead of merely overlapping it.
    const chord = Math.sqrt(LOGO.globeR ** 2 - 9 ** 2);
    const [top, bottom] = [32 - chord, 32 + chord];
    expect(LOGO.hPath).toContain(top.toFixed(2));
    expect(LOGO.hPath).toContain(bottom.toFixed(2));
  });

  it("keeps every ASCII row the width the letterhead aligns against", () => {
    for (const row of LOGO_ASCII) expect([...row]).toHaveLength(LOGO_ASCII_WIDTH);
  });
});

describe("logoSvg", () => {
  it("emits a gradient-framed mark, labelled, at the requested size", () => {
    const svg = logoSvg({ size: 120, idPrefix: "x", title: "Mark & <co>" });
    expect(svg).toContain('width="120"');
    expect(svg).toContain('<linearGradient id="x-frame"');
    expect(svg).toContain('stroke="url(#x-frame)"');
    expect(svg).toContain(BRAND.green);
    expect(svg).toContain(BRAND.cyan);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Mark &amp; &lt;co&gt;"'); // label is escaped
  });

  it("drops the gradient entirely in mono and defaults to 64px, decorative", () => {
    const svg = logoSvg({ mono: BRAND.ink });
    expect(svg).toContain('width="64"');
    expect(svg).not.toContain("linearGradient");
    expect(svg).not.toContain(BRAND.green);
    expect(svg).toContain(`stroke="${BRAND.ink}"`);
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toContain("role=");
  });
});

describe("asciiLetterhead", () => {
  it("sets text beside the mark, and keeps going when the text runs longer", () => {
    const out = asciiLetterhead(["one", "two", "three", "four", "five", "six", "seven"]).split("\n");
    expect(out).toHaveLength(7);
    expect(out[0]).toBe(`${LOGO_ASCII[0]}    one`);
    // Rows past the mark keep the same indent, so the text column stays flush.
    expect(out[6]).toBe(`${" ".repeat(LOGO_ASCII_WIDTH)}    seven`);
  });

  it("finishes the mark on its own when the text runs short, without trailing space", () => {
    const out = asciiLetterhead(["only"]).split("\n");
    expect(out).toHaveLength(LOGO_ASCII.length);
    expect(out[0]).toBe(`${LOGO_ASCII[0]}    only`);
    expect(out[1]).toBe(LOGO_ASCII[1]!.trimEnd());
  });
});

describe("<Logo>", () => {
  it("renders a labelled, gradient mark at the given size with the orbit animated", () => {
    const { container } = render(<Logo size={40} title="HEAVEN-GeoIntel" animated className="opacity-80" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.getAttribute("class")).toBe("shrink-0 hv-logo-mark opacity-80");
    expect(screen.getByRole("img", { name: "HEAVEN-GeoIntel" })).toBeTruthy();
    expect(container.querySelector("linearGradient#hv-logo-frame")).toBeTruthy();
    expect(container.querySelector(".hv-logo-orbit")).toBeTruthy();
  });

  it("is decorative, unanimated and gradient-free in mono at the default size", () => {
    const { container } = render(<Logo mono={BRAND.ink} idPrefix="print" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("28");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    // shrink-0 is unconditional; the animated class is not applied.
    expect(svg.getAttribute("class")).toBe("shrink-0");
    expect(container.querySelector("linearGradient")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("<LogoLockup>", () => {
  it("pairs the mark with the wordmark and the tagline when asked", () => {
    const { container } = render(<LogoLockup tagline animated className="text-base" />);
    expect(screen.getByRole("img", { name: `${BRAND.name} — ${BRAND.tagline}` })).toBeTruthy();
    expect(container.textContent).toContain("HEAVEN");
    expect(container.textContent).toContain("GeoIntel");
    expect(container.textContent).toContain(BRAND.tagline.toLowerCase());
    expect(container.firstElementChild!.getAttribute("class")).toContain("text-base");
  });

  it("omits the tagline by default and keeps the wordmark at every width", () => {
    const { container } = render(<LogoLockup />);
    expect(container.textContent).toContain("GeoIntel");
    expect(container.textContent).not.toContain(BRAND.tagline.toLowerCase());
    expect(container.querySelector(".hv-logo-mark")).toBeNull();
    expect(container.querySelector(".hidden")).toBeNull();
  });

  it("hides only the wordmark below md when compact, never the mark", () => {
    const { container } = render(<LogoLockup compact />);
    const wordmark = container.querySelector(".hidden")!;
    expect(wordmark.textContent).toBe("HEAVEN-GeoIntel");
    expect(wordmark.className).toContain("md:inline");
    // The mark itself must survive — it is the whole point of a compact lockup.
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("shrink-0");
  });
});
