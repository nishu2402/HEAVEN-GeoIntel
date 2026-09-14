import { describe, it, expect } from "vitest";
import nextConfig from "../next.config.mjs";
import { ENDPOINTS } from "@/lib/api/endpoints";

// Every route that takes a target identifier, holds case data or relays an
// evidence bundle answers with something about a person or asset, so no crawler
// may index it and no cache may keep it. next.config.mjs sets those two headers
// per path. It used to do so with one hand-copied block per route, and the
// copies stopped at seven: wallet-lookup, hash-lookup, pwned-password and
// ai-analyst shipped without either header while the README said every lookup
// route sent them. This holds the list to the endpoint registry instead.

describe("private API response headers", () => {
  it("every rate-limited or case route is no-index and no-store", async () => {
    const rules = await nextConfig.headers();
    const privatePaths = [
      ...new Set(ENDPOINTS.filter((e) => e.rateLimited || e.tag === "cases").map((e) => e.path)),
    ];
    // The registry has eleven today; a filter that matched nothing would pass
    // the loop below vacuously.
    expect(privatePaths.length).toBeGreaterThanOrEqual(11);

    for (const path of privatePaths) {
      const rule = rules.find((r) => r.source === `${path}(.*)`);
      expect(rule, path).toBeDefined();
      const headers = Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]));
      expect(headers["X-Robots-Tag"], path).toMatch(/\bnoindex\b/);
      expect(headers["Cache-Control"], path).toMatch(/\bno-store\b/);
    }
  });
});

// ── Avatar hosts vs the CSP image allow-list ─────────────────────────────────
// The username lookup fetches rich profiles from six platforms, and four of
// them serve the profile photo from a host that was never added here. The
// avatars were fetched, perceptually hashed and correlated on the server, then
// blocked by CSP in the browser: the Avatar component hides an image that fails
// to load, so the only symptom was a console error and four platforms whose
// photos silently never appeared. Each host below was read off a live profile.

describe("CSP image allow-list", () => {
  const AVATAR_HOSTS: { platform: string; host: string }[] = [
    { platform: "GitHub", host: "https://avatars.githubusercontent.com" },
    { platform: "GitLab", host: "https://gitlab.com" },
    { platform: "Bluesky", host: "https://cdn.bsky.app" },
    { platform: "Mastodon", host: "https://files.mastodon.social" },
    { platform: "Codeberg", host: "https://codeberg.org" },
    { platform: "Chess.com", host: "https://images.chesscomfiles.com" },
  ];

  async function imgSrc(): Promise<string> {
    const rules = await nextConfig.headers();
    const rule = rules.find((r) =>
      r.headers.some((h: { key: string }) => h.key === "Content-Security-Policy"));
    const csp = rule!.headers.find((h: { key: string }) => h.key === "Content-Security-Policy");
    return csp!.value.split("; ").find((d: string) => d.startsWith("img-src "))!;
  }

  it("allows the photo host of every platform whose profile carries one", async () => {
    const directive = await imgSrc();
    for (const { platform, host } of AVATAR_HOSTS) {
      expect(directive, `${platform} avatars are blocked by CSP`).toContain(host);
    }
  });

  it("stays an allow-list rather than a wildcard", async () => {
    const directive = await imgSrc();
    expect(directive).toContain("'self'");
    expect(directive).not.toContain("*");
    expect(directive).not.toContain("http://");
  });
});
