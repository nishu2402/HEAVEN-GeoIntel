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
  it("serves a valid OpenAPI 3.1 document describing the lookup endpoints", async () => {
    const res = await docsGET();
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("HEAVEN-GeoIntel API");
    expect(spec.paths["/api/lookup"].post).toBeTruthy();
    expect(spec.paths["/api/email-lookup"].post).toBeTruthy();
    expect(spec.components.schemas.LookupResponse).toBeTruthy();
    // Cacheable + CORS-open so external Swagger UIs can import it.
    expect(res.headers.get("Cache-Control")).toContain("max-age");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
