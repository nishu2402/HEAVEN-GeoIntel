import { describe, it, expect, afterEach, vi } from "vitest";
import { GET } from "@/app/api/version/route";
import { resetUpdateCacheForTests } from "@/lib/server/updateCheck";
import { APP_VERSION } from "@/lib/version";

// The update check must be truthful about its own version: it reports an update
// only when GitHub actually returns a newer release tag, and every failure mode
// (no release, rate limit, offline, tag-less release) degrades to "could not
// check" rather than a false alarm. It is also cached, so a busy instance does
// not hammer the unauthenticated GitHub quota.

const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const get = (force = false) =>
  GET(new Request(`http://localhost/api/version${force ? "?force=1" : ""}`));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetUpdateCacheForTests();
});

describe("GET /api/version", () => {
  it("reports an available update when the latest release is newer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonRes(200, { tag_name: "v99.0.0", html_url: "https://github.com/nishu2402/HEAVEN-GeoIntel/releases/tag/v99.0.0", published_at: "2099-01-02T03:04:05Z" }),
    ));
    const res = await get();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const j = await res.json();
    expect(j.current).toBe(APP_VERSION);
    expect(j.latest).toBe("v99.0.0");
    expect(j.updateAvailable).toBe(true);
    expect(j.ok).toBe(true);
    expect(j.url).toContain("/releases/tag/v99.0.0");
    expect(j.publishedAt).toBe("2099-01-02T03:04:05Z");
  });

  it("reports up to date when the latest release equals the running version", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(200, { tag_name: `v${APP_VERSION}` })));
    const j = await (await get()).json();
    expect(j.updateAvailable).toBe(false);
    expect(j.ok).toBe(true);
    // no html_url in the payload falls back to the releases index
    expect(j.url).toBe("https://github.com/nishu2402/HEAVEN-GeoIntel/releases");
    expect(j.publishedAt).toBeNull();
  });

  it("does not claim an update when the latest release is older", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(200, { tag_name: "v0.0.1" })));
    const j = await (await get()).json();
    expect(j.updateAvailable).toBe(false);
    expect(j.ok).toBe(true);
  });

  it("reports 'no releases published yet' on a 404 from GitHub", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(404, { message: "Not Found" })));
    const j = await (await get()).json();
    expect(j.ok).toBe(false);
    expect(j.updateAvailable).toBe(false);
    expect(j.latest).toBeNull();
    expect(j.reason).toBe("no releases published yet");
  });

  it("degrades to 'could not check' when GitHub is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const j = await (await get()).json();
    expect(j.ok).toBe(false);
    expect(j.updateAvailable).toBe(false);
    expect(j.reason).toBe("unreachable");
  });

  it("degrades cleanly when GitHub answers 200 with an empty body", async () => {
    // A 200 whose body parses to null leaves the fetch result ok-but-dataless
    // and with no error string; the checker falls back to a generic reason
    // rather than crashing or inventing a version.
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(200, null)));
    const j = await (await get()).json();
    expect(j.ok).toBe(false);
    expect(j.updateAvailable).toBe(false);
    expect(j.latest).toBeNull();
    expect(j.reason).toBe("could not reach GitHub");
  });

  it("handles a release that carries no version tag", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(200, { html_url: "x" })));
    const j = await (await get()).json();
    expect(j.ok).toBe(true);
    expect(j.latest).toBeNull();
    expect(j.updateAvailable).toBe(false);
    expect(j.reason).toMatch(/no version tag/);
  });

  it("caches a successful check for an hour; force bypasses the cache", async () => {
    const fetchMock = vi.fn(async () => jsonRes(200, { tag_name: "v99.0.0", html_url: "u" }));
    vi.stubGlobal("fetch", fetchMock);
    await get();          // miss → one GitHub call
    await get();          // hit → still one
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await get(true);      // force → a second call
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed check, so the next call retries", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("offline"); });
    vi.stubGlobal("fetch", fetchMock);
    await get();
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-checks once the one-hour cache has expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const fetchMock = vi.fn(async () => jsonRes(200, { tag_name: "v99.0.0", html_url: "u" }));
    vi.stubGlobal("fetch", fetchMock);
    await get();
    vi.setSystemTime(new Date("2026-01-01T01:00:01Z")); // just past the hour
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
