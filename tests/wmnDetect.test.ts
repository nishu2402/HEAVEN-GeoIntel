import { describe, it, expect } from "vitest";
import { classifyWmn, hasContract, needsBody, fillTemplate } from "@/lib/analysis/wmnDetect";

// The four-field contract is STRICTER than the tool's own "HTTP 200 means
// found" rule: both the status and the body marker have to agree, in whichever
// direction. That is what makes hundreds of community-maintained sites safe to
// auto-check when 23 were being checked before.

describe("classifyWmn", () => {
  const site = { ec: 200, es: "profile-header", mc: 404, ms: "not found" };

  it("confirms presence only when status AND marker agree", () => {
    expect(classifyWmn(site, 200, "<div class=profile-header>")).toBe("found");
    expect(classifyWmn(site, 200, "welcome, please sign in")).toBe("unknown");
    expect(classifyWmn(site, 301, "<div class=profile-header>")).toBe("unknown");
  });

  it("confirms absence only when status AND marker agree", () => {
    expect(classifyWmn(site, 404, "user not found")).toBe("notfound");
    expect(classifyWmn(site, 404, "something else entirely")).toBe("unknown");
  });

  it("treats a bot wall or a rate limit as unknown, never as absent", () => {
    expect(classifyWmn(site, 403, "Cloudflare: checking your browser")).toBe("unknown");
    expect(classifyWmn(site, 429, "slow down")).toBe("unknown");
  });

  it("accepts an empty marker as status-only for that direction", () => {
    expect(classifyWmn({ ec: 200, es: "", mc: 404, ms: "gone" }, 200, "anything")).toBe("found");
    expect(classifyWmn({ ec: 200, es: "hit", mc: 302, ms: "" }, 302, "")).toBe("notfound");
  });

  it("calls an ambiguous answer unknown rather than tossing a coin", () => {
    // Same status for both directions and markers that both appear.
    expect(classifyWmn({ ec: 200, es: "a", mc: 200, ms: "b" }, 200, "a and b")).toBe("unknown");
  });
});

describe("hasContract / needsBody", () => {
  it("requires both codes and at least one marker", () => {
    expect(hasContract({ ec: 200, es: "x", mc: 404, ms: "" })).toBe(true);
    expect(hasContract({ ec: 200, es: "", mc: 404, ms: "y" })).toBe(true);
    expect(hasContract({ ec: 200, es: "", mc: 404, ms: "" })).toBe(false);
    expect(hasContract({ es: "x", mc: 404 })).toBe(false);
    expect(hasContract({ ec: 200, es: "x" })).toBe(false);
  });

  it("says when a probe can stop at the status line", () => {
    expect(needsBody({ ec: 200, es: "x", mc: 404, ms: "" })).toBe(true);
    expect(needsBody({ ec: 200, es: "", mc: 404, ms: "" })).toBe(false);
  });
});

describe("fillTemplate", () => {
  it("encodes the handle for a probe URL and leaves the display URL readable", () => {
    expect(fillTemplate("https://x.test/{account}/{account}", "a b")).toBe("https://x.test/a%20b/a%20b");
    expect(fillTemplate("https://x.test/{account}", "a b", false)).toBe("https://x.test/a b");
  });
});
