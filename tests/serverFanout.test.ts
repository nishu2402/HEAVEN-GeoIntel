import { describe, it, expect, afterEach, vi } from "vitest";
import { mapLimit, hostKey } from "@/lib/server/concurrency";
import { hashAvatar, hashAvatars, decodableVariant } from "@/lib/server/avatarHash";
import { placeholderReason, isPlaceholderAvatar } from "@/lib/analysis/avatarPlaceholders";
import { pngFixture, jpegFixture } from "./imageFixtures";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ── mapLimit ─────────────────────────────────────────────────────────────────
// FANOUT_CONCURRENCY was documented, defaulted and tested for three releases
// while being imported by nothing: the username sweep fired every site at once.

describe("mapLimit", () => {
  it("keeps results in input order however they finish", async () => {
    const out = await mapLimit([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms / 10));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it("never exceeds the requested width", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return null;
    });
    expect(peak).toBe(4);
  });

  it("serialises items that share a key, so one host is hit once at a time", async () => {
    const active = new Map<string, number>();
    let collision = 0;
    const items = ["a", "a", "a", "b", "b"];
    await mapLimit(items, 5, async (host) => {
      const n = (active.get(host) ?? 0) + 1;
      active.set(host, n);
      if (n > 1) collision++;
      await new Promise((r) => setTimeout(r, 3));
      active.set(host, (active.get(host) as number) - 1);
      return host;
    }, (host) => host);
    expect(collision).toBe(0);
  });

  it("does not let one rejection poison a shared key's queue", async () => {
    const seen: number[] = [];
    await expect(mapLimit([1, 2], 2, async (n) => {
      seen.push(n);
      if (n === 1) throw new Error("boom");
      return n;
    }, () => "same")).rejects.toThrow("boom");
    // The second item still ran rather than being stuck behind the failure.
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([1, 2]);
  });

  it("handles an empty list and a silly width", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
    expect(await mapLimit([1, 2], 0, async (n) => n)).toEqual([1, 2]);
    expect(await mapLimit([1, 2], 99, async (n) => n)).toEqual([1, 2]);
  });

  it("groups by host, and says so when a URL will not parse", () => {
    expect(hostKey("https://Example.COM/a")).toBe("example.com");
    expect(hostKey("not a url")).toBeNull();
  });
});

// ── avatar hashing ───────────────────────────────────────────────────────────

describe("placeholder avatars", () => {
  it("recognises the defaults platforms hand out", () => {
    expect(placeholderReason("https://mastodon.social/avatars/original/missing.png")).toBe("Mastodon default avatar");
    expect(placeholderReason("https://cdn.discordapp.com/embed/avatars/3.png")).toBe("Discord default avatar");
    expect(placeholderReason("https://gravatar.com/avatar/abc?s=200&d=mm")).toBe("Gravatar fallback image");
    expect(placeholderReason("https://www.chess.com/bundles/web/images/user-image.svg")).toBe("Chess.com default avatar");
    expect(isPlaceholderAvatar("https://x.test/default-avatar.png")).toBe(true);
  });

  it("leaves a real uploaded photo alone", () => {
    expect(placeholderReason("https://avatars.githubusercontent.com/u/1024025?v=4")).toBeNull();
    expect(isPlaceholderAvatar("https://files.mastodon.social/accounts/avatars/000/039/207/original/972a88b4.jpg")).toBe(false);
  });
});

describe("hashAvatar", () => {
  const okResponse = (body: Uint8Array, type = "image/png") => ({
    ok: true, status: 200,
    headers: new Headers({ "content-type": type, "content-length": String(body.length) }),
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    body: null,
  }) as unknown as Response;

  it("hashes a real image fetched over https", async () => {
    const png = pngFixture({ width: 32, height: 32, value: (x, y) => x * 8 + y });
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(png)));
    const out = await hashAvatar({ url: "https://cdn.test/a.png", source: "GitHub" });
    expect("hash" in out).toBe(true);
    expect(typeof (out as { hash: bigint }).hash).toBe("bigint");
  });

  it("never fetches a platform default", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await hashAvatar({ url: "https://mastodon.social/avatars/original/missing.png", source: "Mastodon" });
    expect(out).toMatchObject({ reason: "Mastodon default avatar" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses http, private hosts and non-images, saying which", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(pngFixture({ width: 8, height: 8 }))));
    for (const url of [
      "http://cdn.test/a.png",                 // cleartext
      "https://169.254.169.254/latest/meta",   // cloud metadata
      "https://localhost/a.png",
      "not a url",
    ]) {
      const out = await hashAvatar({ url, source: "X" });
      expect(out, url).toMatchObject({ reason: "image could not be fetched" });
    }
  });

  it("follows a redirect, but only to another public https host", async () => {
    const png = pngFixture({ width: 16, height: 16 });
    const hops: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      hops.push(url);
      if (hops.length === 1) {
        return { ok: false, status: 302, headers: new Headers({ location: "https://cdn2.test/b.png" }), body: null } as unknown as Response;
      }
      return okResponse(png);
    }));
    expect("hash" in (await hashAvatar({ url: "https://cdn.test/a.png", source: "X" }))).toBe(true);
    expect(hops).toEqual(["https://cdn.test/a.png", "https://cdn2.test/b.png"]);

    // A redirect that points inward is refused before it is fetched.
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: false, status: 302, headers: new Headers({ location: "http://127.0.0.1/meta" }), body: null }) as unknown as Response));
    expect(await hashAvatar({ url: "https://cdn.test/a.png", source: "X" })).toMatchObject({
      reason: "image could not be fetched",
    });
  });

  it("gives up on a redirect loop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: false, status: 302, headers: new Headers({ location: "https://cdn.test/a.png" }), body: null }) as unknown as Response));
    expect(await hashAvatar({ url: "https://cdn.test/a.png", source: "X" })).toMatchObject({
      reason: "image could not be fetched",
    });
  });

  it("refuses an oversized or non-image response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: true, status: 200, headers: new Headers({ "content-type": "text/html" }), body: null }) as unknown as Response));
    expect(await hashAvatar({ url: "https://cdn.test/a.png", source: "X" })).toMatchObject({
      reason: "image could not be fetched",
    });

    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: true, status: 200, headers: new Headers({ "content-type": "image/png", "content-length": "9000000" }), body: null }) as unknown as Response));
    expect(await hashAvatar({ url: "https://cdn.test/b.png", source: "X" })).toMatchObject({
      reason: "image could not be fetched",
    });
  });

  it("reports a format it cannot decode instead of guessing a hash", async () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(webp, "image/webp")));
    expect(await hashAvatar({ url: "https://cdn.test/a.webp", source: "X" })).toMatchObject({
      reason: "unsupported image format (WebP and AVIF are not decoded)",
    });
  });

  it("asks cdn.bsky.app for the JPEG it can decode", async () => {
    expect(decodableVariant("https://cdn.bsky.app/img/avatar/plain/did:plc:x/bafkrei"))
      .toBe("https://cdn.bsky.app/img/avatar/plain/did:plc:x/bafkrei@jpeg");
    // Already format-selected, and every other host, are left alone.
    expect(decodableVariant("https://cdn.bsky.app/img/avatar/plain/did:plc:x/bafkrei@png")).toBeNull();
    expect(decodableVariant("https://avatars.githubusercontent.com/u/1")).toBeNull();

    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(url);
      return okResponse(jpegFixture({ blocksWide: 4, blocksHigh: 4, dc: (x) => x * 50 }), "image/jpeg");
    }));
    await hashAvatar({ url: "https://cdn.bsky.app/img/avatar/plain/did:plc:x/bafkrei", source: "Bluesky" });
    expect(asked[0]).toContain("@jpeg");
  });

  it("falls back to the original URL when the variant does not answer", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(url);
      return url.endsWith("@jpeg")
        ? ({ ok: false, status: 404, headers: new Headers(), body: null } as unknown as Response)
        : okResponse(pngFixture({ width: 16, height: 16 }));
    }));
    const out = await hashAvatar({ url: "https://cdn.bsky.app/img/avatar/plain/did/x", source: "Bluesky" });
    expect("hash" in out).toBe(true);
    expect(asked).toHaveLength(2);
  });
});

describe("hashAvatars", () => {
  it("deduplicates by URL and reports what it skipped", async () => {
    const png = pngFixture({ width: 16, height: 16 });
    const fetchSpy = vi.fn(async () => ({
      ok: true, status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      body: null,
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { hashed, skipped } = await hashAvatars([
      { url: "https://cdn.test/a.png", source: "GitHub" },
      { url: "https://cdn.test/a.png", source: "GitLab" },   // same URL: fetched once
      { url: "https://mastodon.social/avatars/original/missing.png", source: "Mastodon" },
    ], 4);

    expect(hashed).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(skipped).toEqual([{
      url: "https://mastodon.social/avatars/original/missing.png",
      source: "Mastodon",
      reason: "Mastodon default avatar",
    }]);
  });
});
