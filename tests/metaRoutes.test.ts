import { describe, it, expect, afterEach } from "vitest";
import { GET as healthGET } from "@/app/api/health/route";
import { GET as docsGET } from "@/app/api/docs/route";

// The two metadata endpoints: liveness probe + OpenAPI document. No auth, no
// third-party calls, no secrets.

afterEach(() => { delete process.env.AUTH_PASSWORD; });

describe("GET /api/health", () => {
  it("reports ok status, name, version, and a no-store cache header", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.name).toBe("HEAVEN-GeoIntel");
    expect(typeof json.version).toBe("string");
    expect(typeof json.uptimeSec).toBe("number");
    expect(json.authGate).toBe(false);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // Must never leak the runtime version (host-fingerprinting surface).
    expect(JSON.stringify(json)).not.toMatch(/node|v\d+\.\d+\.\d+/i);
  });

  it("reflects authGate=true when AUTH_PASSWORD is set", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    const json = await (await healthGET()).json();
    expect(json.authGate).toBe(true);
  });
});

describe("GET /api/docs", () => {
  it("serves a valid OpenAPI 3.1 document describing every endpoint", async () => {
    const res = await docsGET();
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("HEAVEN-GeoIntel API");
    expect(spec.components.schemas.LookupResponse).toBeTruthy();

    // Every lookup mode, not just phone and email — the spec used to cover 3 of
    // 11 routes while the README told people to import it into Postman.
    for (const p of ["/api/lookup", "/api/email-lookup", "/api/username-lookup",
                     "/api/ip-lookup", "/api/domain-lookup", "/api/bulk-lookup"]) {
      expect(spec.paths[p]?.post, `missing POST ${p}`).toBeTruthy();
    }
    for (const p of ["/api/cases", "/api/keys", "/api/sources", "/api/datasets", "/api/health", "/api/docs"]) {
      expect(spec.paths[p], `missing ${p}`).toBeTruthy();
    }
    expect(spec.paths["/api/cases"].delete).toBeTruthy();
    expect(spec.paths["/api/keys"].delete).toBeTruthy();

    // Generated per request from the live config, so it must not be cached.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("states the live rate limit rather than a number baked into the text", async () => {
    process.env.RATE_LIMIT_MAX = "250";
    try {
      const spec = await (await docsGET()).json();
      expect(spec.info.description).toContain("250 requests");
    } finally {
      delete process.env.RATE_LIMIT_MAX;
    }
  });
});
