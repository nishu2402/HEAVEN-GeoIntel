import { describe, it, expect } from "vitest";
import { posterSvg, type PosterStats } from "@/lib/brand/poster";
import { LOGO, BRAND } from "@/lib/brand/logo";

// The poster is the first thing anyone sees of this project, and it makes
// factual claims ("13/21 sources need no key"). These tests hold it to the same
// standard as the rest of the tool: it may only show numbers it was given, it
// must survive a renderer that strips animation, and it must not depend on
// anything it cannot carry inside itself.

const STATS: PosterStats = {
  version: "9.9.9",
  identifiers: 5,
  modes: 8,
  sources: 21,
  freeSources: 13,
  usernameSites: 43,
  autoVerified: 24,
  apiOperations: 17,
  coverage: 100,
};

describe("posterSvg", () => {
  it("prints every stat it was given, and no invented ones", () => {
    const svg = posterSvg(STATS);
    expect(svg).toContain(">5<");
    expect(svg).toContain(">8<");
    expect(svg).toContain(">13/21<");
    expect(svg).toContain(">24/43<");
    expect(svg).toContain(">17<");
    expect(svg).toContain(">100%<");
    expect(svg).toContain("v9.9.9");
  });

  it("draws the mark from the shared geometry rather than its own copy", () => {
    // If someone re-draws the hexagon here, the poster and the favicon start
    // being different logos.
    const svg = posterSvg(STATS);
    expect(svg).toContain(LOGO.hexPath);
    expect(svg).toContain(LOGO.hPath);
    expect(svg).toContain(BRAND.tagline.toUpperCase());
  });

  it("is completely self-contained: GitHub will not fetch anything for it", () => {
    const svg = posterSvg(STATS);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // the xmlns is the only URL
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("@import");
    expect(svg).not.toContain("<script");
  });

  it("carries an accessible label naming the tool and version", () => {
    expect(posterSvg(STATS)).toContain(`aria-label="${BRAND.name} — ${BRAND.tagline}, v9.9.9"`);
  });

  it("still reads as a finished poster with animation stripped", () => {
    const still = posterSvg(STATS, { animated: false });
    expect(still).not.toContain("<style>");
    expect(still).not.toContain("animation:");
    // Nothing important may be hidden waiting for a keyframe: the first prompt,
    // the caret, the wordmark and every stat are all present in the still.
    expect(still).toContain("+1 415 555 2671");
    expect(still).toContain(">13/21<");
    expect(still).toContain("HEAVEN");
  });

  it("cycles all five identifier prompts only when animated", () => {
    const animated = posterSvg(STATS);
    const still = posterSvg(STATS, { animated: false });
    for (const prompt of ["+1 415 555 2671", "target@domain.com", "@handle", "8.8.8.8", "example.com"]) {
      expect(animated).toContain(prompt);
    }
    // The still shows one prompt, not five stacked on top of each other.
    expect(still).toContain("+1 415 555 2671");
    expect(still).not.toContain("target@domain.com");
    expect(still).not.toContain("example.com");
  });

  it("honours prefers-reduced-motion", () => {
    // A looping scan line is exactly what that setting exists to stop.
    expect(posterSvg(STATS)).toContain("@media(prefers-reduced-motion:reduce)");
  });

  it("renders a light theme that is not just an inversion", () => {
    const dark = posterSvg(STATS, { theme: "dark" });
    const light = posterSvg(STATS, { theme: "light" });
    // #00ff85 on white is unreadable, so the light palette drops the neons.
    expect(dark).toContain(BRAND.green);
    expect(light).not.toContain(BRAND.green);
    expect(light).toContain("#00a862");
    expect(light).toContain('fill="url(#bg)"');
  });

  it("scales to a requested width, keeping the aspect ratio", () => {
    const svg = posterSvg(STATS, { width: 640 });
    expect(svg).toContain('width="640" height="240"');
    expect(svg).toContain('viewBox="0 0 1280 480"');
  });

  it("escapes anything that would otherwise break the document", () => {
    const svg = posterSvg({ ...STATS, version: '1.0"><script>x</script>' });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});
