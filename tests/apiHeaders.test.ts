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
