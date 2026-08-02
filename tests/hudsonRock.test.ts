import { describe, it, expect, afterEach, vi } from "vitest";
import { hudsonRockFor, malwareFamily, unmasked } from "@/lib/server/hudsonRock";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const resp = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function stub(handler: (url: string) => Response) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => { seen.push(String(u)); return handler(String(u)); }));
  return seen;
}

describe("unmasked", () => {
  it("rejects Cavalier's free-tier masking, keeps real values", () => {
    // These are the shapes the live free tier actually returns.
    expect(unmasked("82.167.***.**")).toBeNull();
    expect(unmasked("i****@gmail.com")).toBeNull();
    expect(unmasked("8.8.8.8")).toBe("8.8.8.8");
    expect(unmasked("  spaced  ")).toBe("spaced");
  });

  it("treats empty, whitespace and absent values as nothing", () => {
    expect(unmasked(null)).toBeNull();
    expect(unmasked(undefined)).toBeNull();
    expect(unmasked("")).toBeNull();
    expect(unmasked("   ")).toBeNull();
  });
});

describe("malwareFamily", () => {
  it("prefers the API's own stealer_family field", () => {
    expect(malwareFamily("Acreed", "C:/x/redline.exe")).toBe("Acreed");
  });

  it("ignores the literal 'Not Found' sentinel on either field", () => {
    expect(malwareFamily("Not Found", "C:/x/lumma.exe")).toBe("Lumma");
    expect(malwareFamily(undefined, "Not Found")).toBeNull();
    expect(malwareFamily("", "")).toBeNull();
  });

  it("sniffs a known family out of the executable path", () => {
    expect(malwareFamily(undefined, "C:\\Users\\v\\AppData\\RedLine.exe")).toBe("Redline");
  });

  it("returns null rather than passing off a dropper filename as a family", () => {
    // A live lookup returned this shape. Rendering "45AMJCDPU" in the malware
    // badge would present a random token as an identification.
    expect(malwareFamily(undefined, "C:\\Users\\v\\45AmJcDpU.exe")).toBeNull();
    expect(malwareFamily(undefined, "C:\\tmp\\weird_thing.exe")).toBeNull();
    expect(malwareFamily(undefined, "plainfile")).toBeNull();
  });
});

describe("hudsonRockFor", () => {
  it("uses the search-by-email endpoint for an email", async () => {
    const seen = stub(() => resp(200, { stealers: [] }));
    await hudsonRockFor("ada@example.com", "email");
    expect(seen[0]).toContain("search-by-email?email=ada%40example.com");
  });

  it("uses the search-by-username endpoint for a phone or handle", async () => {
    // Verified live: search-by-login rejects an email with HTTP 400 "Email is
    // required", so the endpoint choice is not cosmetic.
    const seen = stub(() => resp(200, { stealers: [] }));
    await hudsonRockFor("+919876543210", "identifier");
    expect(seen[0]).toContain("search-by-username?username=%2B919876543210");
  });

  it("maps a hit, capping stealers at 10 and samples at 5", async () => {
    const one = {
      computer_name: "IRSHAD", operating_system: "Windows 11", stealer_family: "Acreed",
      date_compromised: "2026-07-25T17:35:25.159Z", ip: "82.167.***.**",
      top_passwords: ["a", "b", "c", "d", "e", "f"],
      top_logins: ["l1", "l2", "l3", "l4", "l5", "l6"],
    };
    stub(() => resp(200, { message: "infected", stealers: Array.from({ length: 12 }, () => one) }));
    const r = await hudsonRockFor("x@y.com", "email");
    expect(r.ok).toBe(true);
    expect(r.data!.total).toBe(12);          // total reports the FULL count…
    expect(r.data!.stealers).toHaveLength(10); // …while the detail list is capped
    expect(r.data!.stealers[0].topPasswords).toHaveLength(5);
    expect(r.data!.stealers[0].topLogins).toHaveLength(5);
    expect(r.data!.stealers[0].malwareFamily).toBe("Acreed");
    expect(r.data!.message).toBe("infected");
  });

  it("defaults every absent stealer field rather than dropping the record", async () => {
    stub(() => resp(200, { stealers: [{}] }));
    const r = await hudsonRockFor("x@y.com", "email");
    expect(r.data!.stealers[0]).toEqual({
      computerName: null, operatingSystem: null, malwareFamily: null,
      dateCompromised: null, ip: null, topPasswords: [], topLogins: [],
    });
  });

  it("reports an empty result as a clean answer with the API's own message", async () => {
    stub(() => resp(200, { message: "not associated with an infection" }));
    expect(await hudsonRockFor("x@y.com", "email")).toEqual({
      ok: true, data: { total: 0, stealers: [], message: "not associated with an infection" },
    });
  });

  it("uses a default message when the API sends none", async () => {
    stub(() => resp(200, { stealers: [] }));
    expect((await hudsonRockFor("x@y.com", "email")).data!.message).toBe("No infections found");
  });

  it("treats 404 as clean and 429 as rate-limited", async () => {
    stub(() => resp(404, {}));
    expect(await hudsonRockFor("x@y.com", "email")).toEqual({
      ok: true, data: { total: 0, stealers: [], message: "No infections found" },
    });
    stub(() => resp(429, {}));
    expect(await hudsonRockFor("x@y.com", "email")).toEqual({ ok: false, error: "RATE_LIMITED" });
  });

  it("surfaces other HTTP errors and never throws on a network failure", async () => {
    stub(() => resp(500, {}));
    expect(await hudsonRockFor("x@y.com", "email")).toEqual({ ok: false, error: "HTTP 500" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await hudsonRockFor("x@y.com", "email")).toEqual({ ok: false, error: "request failed" });
  });
});
