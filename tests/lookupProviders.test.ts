import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/lookup/route";
import { restoreRateLimit } from "./testUtils";

// Every paid phone provider, exercised on its success path AND on each way it
// can fail. These fetches are the app's whole outbound surface; before 1.4 they
// sat outside the coverage gate and only the keyless path was ever run.
//
// The invariant under test throughout: a provider that errors, times out or
// returns junk NEVER fails the lookup and NEVER contributes a fabricated field.

let dir: string;
const KEYS = [
  "NUMVERIFY_API_KEY", "IPQS_API_KEY", "ABSTRACT_API_KEY",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RAPIDAPI_KEY", "FULLCONTACT_API_KEY",
];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-providers-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});
afterEach(() => {
  vi.unstubAllGlobals();
  KEYS.forEach((k) => delete process.env[k]);
  restoreRateLimit();
});

const resp = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

const hudsonClean = resp(200, { message: "not associated", stealers: [] });

function stub(map: Array<[string, Response | (() => never)]>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    for (const [needle, r] of map) {
      if (u.includes(needle)) {
        if (typeof r === "function") return r();
        return r;
      }
    }
    return hudsonClean; // anything unstubbed behaves like the keyless baseline
  }));
}

let n = 0;
const lookup = (number = `+1415555${String(1000 + n++).slice(0, 4)}`) =>
  POST(new Request("http://localhost/api/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ number }),
  }) as unknown as NextRequest);

const timeout = () => { throw Object.assign(new DOMException("t", "TimeoutError")); };

describe("NumVerify", () => {
  it("merges carrier and line type on success", async () => {
    process.env.NUMVERIFY_API_KEY = "k";
    stub([["apilayer.net", resp(200, {
      valid: true, carrier: "AT&T Mobility", line_type: "mobile", location: "San Francisco",
    })]]);
    const json = await (await lookup()).json();
    expect(json.sources.numverify.ok).toBe(true);
    expect(json.aggregated.carrier).toBe("AT&T Mobility");
  });

  it("reports an API-level error object as a failure", async () => {
    process.env.NUMVERIFY_API_KEY = "k";
    stub([["apilayer.net", resp(200, { error: { info: "You have exceeded your quota" } })]]);
    const json = await (await lookup()).json();
    expect(json.sources.numverify).toEqual({ ok: false, error: "You have exceeded your quota" });
    expect(json.aggregated.carrier).toBeNull(); // never invented
  });

  it("reports a non-2xx as HTTP n", async () => {
    process.env.NUMVERIFY_API_KEY = "k";
    stub([["apilayer.net", resp(403, {})]]);
    expect((await (await lookup()).json()).sources.numverify.error).toBe("HTTP 403");
  });

  it("reports a timeout without failing the lookup", async () => {
    process.env.NUMVERIFY_API_KEY = "k";
    stub([["apilayer.net", timeout]]);
    const res = await lookup();
    expect(res.status).toBe(200);
    expect((await res.json()).sources.numverify.error).toBe("timed out");
  });
});

describe("IPQualityScore", () => {
  it("merges the full fraud picture on success", async () => {
    process.env.IPQS_API_KEY = "k";
    stub([["ipqualityscore.com", resp(200, {
      success: true, fraud_score: 88, VOIP: true, prepaid: true, risky: true,
      recent_abuse: true, active: true, active_status: "Active", user_activity: "high",
      carrier: "T-Mobile", line_type: "Wireless", region: "Texas", city: "Austin",
      name: "A. Person", associated_email_addresses: { status: "ok", emails: ["a@x.test"] },
    })]]);
    const json = await (await lookup()).json();
    expect(json.aggregated.fraudScore).toBe(88);
    expect(json.aggregated.prepaid).toBe(true);
    expect(json.aggregated.activeStatus).toBe("Active");
    expect(json.aggregated.userActivity).toBe("high");
    expect(json.aggregated.city).toBe("Austin");
    expect(json.aggregated.associatedEmails).toEqual(["a@x.test"]);
  });

  it("treats success:false as an error with the API's message", async () => {
    process.env.IPQS_API_KEY = "k";
    stub([["ipqualityscore.com", resp(200, { success: false, message: "Invalid key" })]]);
    expect((await (await lookup()).json()).sources.ipqs).toEqual({ ok: false, error: "Invalid key" });
  });

  it("falls back to a generic message when the API omits one", async () => {
    process.env.IPQS_API_KEY = "k";
    stub([["ipqualityscore.com", resp(200, { success: false })]]);
    expect((await (await lookup()).json()).sources.ipqs.error).toBe("IPQS error");
  });

  it("reports a non-2xx and a timeout", async () => {
    process.env.IPQS_API_KEY = "k";
    stub([["ipqualityscore.com", resp(500, {})]]);
    expect((await (await lookup()).json()).sources.ipqs.error).toBe("HTTP 500");

    stub([["ipqualityscore.com", timeout]]);
    expect((await (await lookup()).json()).sources.ipqs.error).toBe("timed out");
  });
});

describe("AbstractAPI (phone)", () => {
  it("succeeds, and reports its error object, HTTP failure and timeout", async () => {
    process.env.ABSTRACT_API_KEY = "k";
    stub([["phonevalidation.abstractapi.com", resp(200, {
      valid: true, carrier: "Vodafone", type: "mobile", location: "London",
    })]]);
    expect((await (await lookup()).json()).sources.abstract.ok).toBe(true);

    stub([["phonevalidation.abstractapi.com", resp(200, { error: { message: "Quota reached" } })]]);
    expect((await (await lookup()).json()).sources.abstract.error).toBe("Quota reached");

    stub([["phonevalidation.abstractapi.com", resp(401, {})]]);
    expect((await (await lookup()).json()).sources.abstract.error).toBe("HTTP 401");

    stub([["phonevalidation.abstractapi.com", timeout]]);
    expect((await (await lookup()).json()).sources.abstract.error).toBe("timed out");
  });
});

describe("Twilio Lookup", () => {
  it("stays NOT_CONFIGURED unless BOTH the sid and the token are present", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    stub([]);
    expect((await (await lookup()).json()).sources.twilio.error).toBe("NOT_CONFIGURED");
  });

  it("merges caller name and MCC/MNC on success", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    stub([["lookups.twilio.com", resp(200, {
      valid: true,
      caller_name: { caller_name: "JANE DOE", caller_type: "CONSUMER", error_code: null },
      line_type_intelligence: {
        error_code: null, mobile_country_code: "310", mobile_network_code: "260",
        carrier_name: "T-Mobile USA", type: "mobile",
      },
    })]]);
    const json = await (await lookup()).json();
    expect(json.aggregated.callerName).toBe("JANE DOE");
    expect(json.aggregated.callerType).toBe("CONSUMER");
    expect(json.aggregated.mobileCountryCode).toBe("310");
    expect(json.aggregated.mobileNetworkCode).toBe("260");
  });

  it("surfaces Twilio's own error message on a non-2xx", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    stub([["lookups.twilio.com", resp(401, { message: "Authenticate" })]]);
    expect((await (await lookup()).json()).sources.twilio.error).toBe("Authenticate");
  });

  it("falls back to HTTP n when the error body isn't JSON", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    stub([["lookups.twilio.com", {
      ok: false, status: 502, json: async () => { throw new Error("not json"); },
    } as unknown as Response]]);
    expect((await (await lookup()).json()).sources.twilio.error).toBe("HTTP 502");
  });

  it("reports a timeout", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    stub([["lookups.twilio.com", timeout]]);
    expect((await (await lookup()).json()).sources.twilio.error).toBe("timed out");
  });
});

describe("BreachDirectory (phone)", () => {
  it("returns real hits on success", async () => {
    process.env.RAPIDAPI_KEY = "k";
    stub([["breachdirectory.p.rapidapi.com", resp(200, {
      found: 2, fields: ["password"], sources: ["Leak"],
      result: [{ password: "p", sha1: "s", hash: "h", sources: ["Leak"] }],
    })]]);
    const json = await (await lookup()).json();
    expect(json.sources.breachDirectory.data.found).toBe(2);
    expect(json.sources.breachDirectory.data.results[0].password).toBe("p");
  });

  it("defaults every missing field rather than emitting undefined", async () => {
    process.env.RAPIDAPI_KEY = "k";
    stub([["breachdirectory.p.rapidapi.com", resp(200, { found: 1, result: [{}] })]]);
    const d = (await (await lookup()).json()).sources.breachDirectory.data;
    expect(d).toEqual({
      found: 1, fields: [], sources: [],
      results: [{ password: "", sha1: "", hash: "", sources: [] }],
    });
  });

  it("treats 404 and found:0 alike as a clean, successful answer", async () => {
    process.env.RAPIDAPI_KEY = "k";
    stub([["breachdirectory.p.rapidapi.com", resp(404, {})]]);
    let json = await (await lookup()).json();
    expect(json.sources.breachDirectory).toEqual({ ok: true, data: { found: 0, fields: [], sources: [], results: [] } });

    stub([["breachdirectory.p.rapidapi.com", resp(200, { found: 0 })]]);
    json = await (await lookup()).json();
    expect(json.sources.breachDirectory.data.found).toBe(0);
  });

  it("reports rate limiting, HTTP failure and timeout distinctly", async () => {
    process.env.RAPIDAPI_KEY = "k";
    stub([["breachdirectory.p.rapidapi.com", resp(429, {})]]);
    expect((await (await lookup()).json()).sources.breachDirectory.error).toBe("RATE_LIMITED");

    stub([["breachdirectory.p.rapidapi.com", resp(500, {})]]);
    expect((await (await lookup()).json()).sources.breachDirectory.error).toBe("HTTP 500");

    stub([["breachdirectory.p.rapidapi.com", timeout]]);
    expect((await (await lookup()).json()).sources.breachDirectory.error).toBe("timed out");
  });
});

describe("FullContact (phone)", () => {
  it("normalises a full person record", async () => {
    process.env.FULLCONTACT_API_KEY = "k";
    stub([["api.fullcontact.com", resp(200, {
      fullName: "Jane Doe", age: 41, gender: "Female", location: "Austin, TX",
      title: "CTO", organization: "Acme", bio: "b", avatar: "https://a.test/x.png",
      details: {
        profiles: { twitter: { url: "https://x.test/jane", username: "jane" }, nourl: {} },
        emails: [{ value: "jane@x.test" }, {}],
        phones: [{ value: "+15550000001" }, { value: "+19999999999" }],
        employment: [{ name: "Acme", title: "CTO", current: true }, { title: "no name" }],
      },
    })]]);
    const d = (await (await lookup("+15550000001")).json()).sources.fullContact.data;
    expect(d.fullName).toBe("Jane Doe");
    expect(d.profiles).toEqual([{ platform: "Twitter", url: "https://x.test/jane", username: "jane" }]);
    expect(d.otherEmails).toEqual(["jane@x.test"]);
    // The number we looked up is filtered out of "other phones".
    expect(d.phones).toEqual(["+19999999999"]);
    expect(d.employment).toEqual([{ name: "Acme", title: "CTO", current: true }]);
  });

  it("nulls every absent field instead of guessing", async () => {
    process.env.FULLCONTACT_API_KEY = "k";
    stub([["api.fullcontact.com", resp(200, {})]]);
    const d = (await (await lookup()).json()).sources.fullContact.data;
    expect(d).toMatchObject({
      fullName: null, age: null, gender: null, location: null,
      title: null, organization: null, bio: null, avatar: null,
      profiles: [], otherEmails: [], phones: [], employment: [],
    });
  });

  it("maps 404, 422 and the sentinel message to NOT_FOUND", async () => {
    process.env.FULLCONTACT_API_KEY = "k";
    for (const status of [404, 422]) {
      stub([["api.fullcontact.com", resp(status, {})]]);
      expect((await (await lookup()).json()).sources.fullContact.error, String(status)).toBe("NOT_FOUND");
    }
    stub([["api.fullcontact.com", resp(200, { message: "Unable to process request" })]]);
    expect((await (await lookup()).json()).sources.fullContact.error).toBe("NOT_FOUND");
  });

  it("reports rate limiting, HTTP failure and timeout", async () => {
    process.env.FULLCONTACT_API_KEY = "k";
    stub([["api.fullcontact.com", resp(429, {})]]);
    expect((await (await lookup()).json()).sources.fullContact.error).toBe("RATE_LIMITED");

    stub([["api.fullcontact.com", resp(500, {})]]);
    expect((await (await lookup()).json()).sources.fullContact.error).toBe("HTTP 500");

    stub([["api.fullcontact.com", timeout]]);
    expect((await (await lookup()).json()).sources.fullContact.error).toBe("timed out");
  });
});

describe("Hudson Rock (free, always called)", () => {
  it("names the malware family from the payload path", async () => {
    stub([["cavalier.hudsonrock.com", resp(200, {
      stealers: [
        { computer_name: "PC1", operating_system: "Win10", malware_path: "C:\\lumma.exe",
          date_compromised: "2024-01-01", ip: "1.2.3.4", top_passwords: ["a"], top_logins: ["b"] },
        { computer_name: "PC2", malware_path: "C:\\tools\\unknown_thing.exe" },
        { computer_name: "PC3" },
      ],
    })]]);
    const d = (await (await lookup()).json()).sources.hudsonRock.data;
    expect(d.total).toBe(3);
    expect(d.stealers[0].malwareFamily).toBe("Lumma");
    // Unrecognised path → null. It used to return the bare filename, which meant
    // a dropper named "45AmJcDpU.exe" rendered as a malware family. See §8.9.
    expect(d.stealers[1].malwareFamily).toBeNull();
    expect(d.stealers[2].malwareFamily).toBeNull();
  });

  it("treats 404 as a clean result", async () => {
    stub([["cavalier.hudsonrock.com", resp(404, {})]]);
    const json = await (await lookup()).json();
    expect(json.sources.hudsonRock).toEqual({
      ok: true, data: { total: 0, stealers: [], message: "No infections found" },
    });
  });

  it("reports rate limiting, HTTP failure and timeout", async () => {
    stub([["cavalier.hudsonrock.com", resp(429, {})]]);
    expect((await (await lookup()).json()).sources.hudsonRock.error).toBe("RATE_LIMITED");

    stub([["cavalier.hudsonrock.com", resp(503, {})]]);
    expect((await (await lookup()).json()).sources.hudsonRock.error).toBe("HTTP 503");

    stub([["cavalier.hudsonrock.com", timeout]]);
    expect((await (await lookup()).json()).sources.hudsonRock.error).toBe("timed out");
  });

  it("handles a response with no stealers array at all", async () => {
    stub([["cavalier.hudsonrock.com", resp(200, { message: "nothing here" })]]);
    const d = (await (await lookup()).json()).sources.hudsonRock.data;
    expect(d.total).toBe(0);
    expect(d.stealers).toEqual([]);
  });
});

describe("aggregation never invents a value", () => {
  it("prefers the IPQS timezone, then libphonenumber, then the country dataset", async () => {
    process.env.IPQS_API_KEY = "k";
    stub([["ipqualityscore.com", resp(200, { success: true, timezone: "America/Chicago" })]]);
    expect((await (await lookup("+14155550111")).json()).aggregated.timezone).toEqual(["America/Chicago"]);

    // No IPQS timezone → the NPA-derived zone from offline analysis.
    stub([["ipqualityscore.com", resp(200, { success: true })]]);
    expect((await (await lookup("+14155550112")).json()).aggregated.timezone).toEqual(["America/Los_Angeles"]);
  });

  it("prefers a Twilio caller name over the IPQS one", async () => {
    process.env.IPQS_API_KEY = "k";
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_AUTH_TOKEN = "t";
    stub([
      ["ipqualityscore.com", resp(200, { success: true, name: "IPQS Name" })],
      ["lookups.twilio.com", resp(200, { caller_name: { caller_name: "Twilio Name" } })],
    ]);
    expect((await (await lookup()).json()).aggregated.callerName).toBe("Twilio Name");
  });

  it("falls back to the IPQS name when Twilio has none", async () => {
    process.env.IPQS_API_KEY = "k";
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_AUTH_TOKEN = "t";
    stub([
      ["ipqualityscore.com", resp(200, { success: true, name: "IPQS Name" })],
      ["lookups.twilio.com", resp(200, {})],
    ]);
    const agg = (await (await lookup()).json()).aggregated;
    expect(agg.callerName).toBe("IPQS Name");
    expect(agg.callerType).toBeNull();
    expect(agg.mobileCountryCode).toBeNull();
  });

  it("leaves every enrichment field null when nothing is configured", async () => {
    stub([]);
    const agg = (await (await lookup()).json()).aggregated;
    for (const field of ["fraudScore", "isVoip", "isRisky", "recentAbuse", "callerName",
                         "prepaid", "active", "activeStatus", "userActivity", "city",
                         "mobileCountryCode", "mobileNetworkCode", "associatedEmails"]) {
      expect(agg[field], field).toBeNull();
    }
    expect(agg.isDisposable).toBeNull();
  });
});

describe("threat score bands", () => {
  const scoreFor = async (ipqs: Record<string, unknown>, extra: Array<[string, Response]> = []) => {
    process.env.IPQS_API_KEY = "k";
    stub([["ipqualityscore.com", resp(200, { success: true, ...ipqs })], ...extra]);
    return (await (await lookup()).json()) as { threatScore: number; threatLabel: string };
  };

  it("is CLEAN with nothing adverse", async () => {
    const r = await scoreFor({});
    expect(r.threatScore).toBe(0);
    expect(r.threatLabel).toBe("CLEAN");
  });

  it("never emits a NaN score when IPQS omits or malforms fraud_score", async () => {
    // A success response without fraud_score used to reach the threat maths as
    // undefined, producing NaN and serialising to `threatScore: null`.
    for (const fraud of [undefined, "high", null, NaN]) {
      process.env.IPQS_API_KEY = "k";
      stub([["ipqualityscore.com", resp(200, { success: true, fraud_score: fraud })]]);
      const json = await (await lookup()).json();
      expect(json.aggregated.fraudScore, String(fraud)).toBeNull();
      expect(typeof json.threatScore, String(fraud)).toBe("number");
      expect(json.threatScore).toBe(0);
    }
  });

  it("raises the floor for an inactive line and bumps for prepaid", async () => {
    const r = await scoreFor({ active: false, prepaid: true });
    expect(r.threatScore).toBe(35); // max(0,30) + 5
    expect(r.threatLabel).toBe("MODERATE");
  });

  it("scores a low-fraud number as LOW RISK", async () => {
    const r = await scoreFor({ fraud_score: 10 });
    expect(r.threatLabel).toBe("LOW RISK");
  });

  it("adds breach hits, capped", async () => {
    process.env.RAPIDAPI_KEY = "k";
    const r = await scoreFor({}, [["breachdirectory.p.rapidapi.com", resp(200, { found: 99, result: [] })]]);
    expect(r.threatScore).toBe(30); // 99*8 capped at 30
  });

  it("treats an infostealer infection as CRITICAL", async () => {
    const r = await scoreFor({}, [["cavalier.hudsonrock.com", resp(200, {
      stealers: [{ computer_name: "A", malware_path: "vidar.exe" }],
    })]]);
    expect(r.threatScore).toBe(70); // floor 60 + 1×10
    expect(r.threatLabel).toBe("CRITICAL");
  });

  it("never exceeds 100", async () => {
    process.env.RAPIDAPI_KEY = "k";
    const r = await scoreFor(
      { fraud_score: 100, risky: true, recent_abuse: true, active: false, prepaid: true },
      [
        ["breachdirectory.p.rapidapi.com", resp(200, { found: 50, result: [] })],
        ["cavalier.hudsonrock.com", resp(200, {
          stealers: Array.from({ length: 5 }, (_, i) => ({ computer_name: `P${i}`, malware_path: "redline.exe" })),
        })],
      ],
    );
    expect(r.threatScore).toBe(100);
    expect(r.threatLabel).toBe("CRITICAL");
  });

  it("flags a premium-rate number without any API help", async () => {
    stub([]);
    // +1 900 numbers are premium-rate, detected entirely offline.
    const json = await (await lookup("+19005550123")).json();
    expect(json.aggregated.isPremiumRate).toBe(true);
    expect(json.threatScore).toBeGreaterThanOrEqual(60);
  });

  it("marks a toll-free number as such offline", async () => {
    stub([]);
    const json = await (await lookup("+18005550199")).json();
    expect(json.aggregated.isTollFree).toBe(true);
  });
});

describe("uniform source health", () => {
  it("reports every phone source once, marking unconfigured ones as skipped", async () => {
    stub([]);
    const json = await (await lookup()).json();
    const health: Array<{ source: string; ok: boolean; skipped?: boolean }> = json.sourceHealth;

    expect(health.map((h) => h.source).sort()).toEqual([
      "abstract", "breachDirectory", "fullContact", "hudsonRock", "ipqs",
      "leakCheck", "numverify", "twilio",
    ]);
    // Keyless: Hudson Rock and LeakCheck answered, the six keyed providers were
    // skipped — "not configured" is not the same as "down".
    expect(health.find((h) => h.source === "hudsonRock")?.ok).toBe(true);
    expect(health.find((h) => h.source === "leakCheck")?.ok).toBe(true);
    expect(health.filter((h) => h.skipped).length).toBe(6);
  });

  it("marks a genuinely failing source as not-ok rather than skipped", async () => {
    process.env.IPQS_API_KEY = "k";
    stub([["ipqualityscore.com", resp(500, {})]]);
    const health = (await (await lookup()).json()).sourceHealth as Array<{ source: string; ok: boolean; skipped?: boolean }>;
    const ipqs = health.find((h) => h.source === "ipqs")!;
    expect(ipqs.ok).toBe(false);
    expect(ipqs.skipped).toBeUndefined();
  });
});
