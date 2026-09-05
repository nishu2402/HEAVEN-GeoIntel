import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { isHost } from "./urlMatch";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/email-lookup/route";
import { restoreRateLimit } from "./testUtils";

// Every email provider on its success path and each failure mode. Same
// invariant as the phone route: a provider that fails never fails the lookup
// and never contributes an invented field.

let dir: string;
const KEYS = ["EMAILREP_API_KEY", "ABSTRACT_API_KEY", "HUNTER_API_KEY", "FULLCONTACT_API_KEY", "RAPIDAPI_KEY"];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-emailproviders-"));
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

function stub(map: Array<[string, Response | (() => never)]>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    for (const [needle, r] of map) {
      if (u.includes(needle)) return typeof r === "function" ? r() : r;
    }
    // Unstubbed upstreams behave like a keyless install with nothing found.
    if (isHost(u, "gravatar.com")) return resp(404, {});
    return resp(200, { Error: "Not found" });
  }));
}

let n = 0;
const lookup = (email = `probe${n++}@example.test`) =>
  POST(new Request("http://localhost/api/email-lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }) as unknown as NextRequest);

const timeout = () => { throw Object.assign(new DOMException("t", "TimeoutError")); };

describe("Gravatar (free)", () => {
  it("normalises a full profile", async () => {
    stub([["gravatar.com", resp(200, {
      entry: [{
        displayName: "Jane", preferredUsername: "jane", aboutMe: "bio",
        currentLocation: "Berlin", profileUrl: "https://gravatar.com/jane",
        thumbnailUrl: "https://gravatar.com/avatar/abc",
        accounts: [{ shortname: "github", username: "jane", url: "https://github.com/jane" }, {}],
      }],
    })]]);
    const g = (await (await lookup()).json()).gravatar;
    expect(g.found).toBe(true);
    expect(g.displayName).toBe("Jane");
    expect(g.thumbnailUrl).toBe("https://gravatar.com/avatar/abc?s=200");
    expect(g.accounts).toEqual([
      { shortname: "github", username: "jane", url: "https://github.com/jane" },
      { shortname: "", username: "", url: "" },
    ]);
  });

  it("synthesises an avatar URL when the profile omits one", async () => {
    stub([["gravatar.com", resp(200, { entry: [{ displayName: "NoPic" }] })]]);
    const g = (await (await lookup()).json()).gravatar;
    expect(g.thumbnailUrl).toMatch(/^https:\/\/gravatar\.com\/avatar\/[0-9a-f]{64}\?s=200&d=404$/);
    expect(g.preferredUsername).toBeNull();
  });

  it("treats 404 and an empty entry list as 'no profile', not an error", async () => {
    stub([["gravatar.com", resp(404, {})]]);
    let json = await (await lookup()).json();
    expect(json.gravatar.found).toBe(false);
    expect(json.sourceHealth.find((h: { source: string }) => h.source === "gravatar").ok).toBe(true);

    stub([["gravatar.com", resp(200, { entry: [] })]]);
    json = await (await lookup()).json();
    expect(json.gravatar.found).toBe(false);
  });

  it("reports a real outage as unhealthy while still returning an empty profile", async () => {
    stub([["gravatar.com", resp(503, {})]]);
    let json = await (await lookup()).json();
    expect(json.gravatar.found).toBe(false);
    let health = json.sourceHealth.find((h: { source: string }) => h.source === "gravatar");
    expect(health.ok).toBe(false);
    expect(health.error).toBe("HTTP 503");

    stub([["gravatar.com", timeout]]);
    json = await (await lookup()).json();
    health = json.sourceHealth.find((h: { source: string }) => h.source === "gravatar");
    expect(health.error).toBe("timed out");
  });
});

describe("EmailRep.io", () => {
  it("normalises reputation and breach flags", async () => {
    process.env.EMAILREP_API_KEY = "k";
    stub([["emailrep.io", resp(200, {
      email: "x@y.test", reputation: "low", suspicious: true, references: 4,
      details: {
        blacklisted: true, malicious_activity: true, credentials_leaked: true, data_breach: true,
        first_seen: "2020-01-01", last_seen: "2024-01-01", domain_exists: true, new_domain: false,
        free_provider: true, disposable: false, deliverable: true, valid_mx: true,
        primary_mx: "mx.y.test", spam: true, spoofable: true, spf_strict: true,
        dmarc_enforced: true, profiles: ["twitter"],
      },
    })]]);
    const d = (await (await lookup()).json()).emailrep.data;
    expect(d.reputation).toBe("low");
    expect(d.credentialsLeaked).toBe(true);
    expect(d.primaryMx).toBe("mx.y.test");
    expect(d.profiles).toEqual(["twitter"]);
  });

  it("defaults every field when details are missing", async () => {
    process.env.EMAILREP_API_KEY = "k";
    stub([["emailrep.io", resp(200, {})]]);
    const d = (await (await lookup()).json()).emailrep.data;
    expect(d.reputation).toBe("none");
    expect(d.suspicious).toBe(false);
    expect(d.firstSeen).toBeNull();
    expect(d.profiles).toEqual([]);
  });

  it("stays NOT_CONFIGURED without a key: the keyless tier only ever 429s", async () => {
    stub([]);
    expect((await (await lookup()).json()).emailrep.error).toBe("NOT_CONFIGURED");
  });

  it("reports rate limiting, HTTP failure and timeout", async () => {
    process.env.EMAILREP_API_KEY = "k";
    stub([["emailrep.io", resp(429, {})]]);
    expect((await (await lookup()).json()).emailrep.error).toBe("RATE_LIMITED");

    stub([["emailrep.io", resp(500, {})]]);
    expect((await (await lookup()).json()).emailrep.error).toBe("HTTP 500");

    stub([["emailrep.io", timeout]]);
    expect((await (await lookup()).json()).emailrep.error).toBe("timed out");
  });
});

describe("AbstractAPI (email)", () => {
  it("normalises the validation result", async () => {
    process.env.ABSTRACT_API_KEY = "k";
    stub([["emailvalidation.abstractapi.com", resp(200, {
      email: "x@y.test", autocorrect: "x@y.test", deliverability: "DELIVERABLE", quality_score: 0.9,
      is_valid_format: { value: true }, is_free_email: { value: true },
      is_disposable_email: { value: false }, is_role_email: { value: false },
      is_catchall_email: { value: false }, is_mx_found: { value: true }, is_smtp_valid: { value: true },
    })]]);
    const d = (await (await lookup()).json()).abstract.data;
    expect(d.deliverability).toBe("DELIVERABLE");
    expect(d.qualityScore).toBe(0.9);
    expect(d.isMxFound).toBe(true);
  });

  it("defaults an empty response rather than emitting undefined", async () => {
    process.env.ABSTRACT_API_KEY = "k";
    stub([["emailvalidation.abstractapi.com", resp(200, {})]]);
    const d = (await (await lookup("defaults@example.test")).json()).abstract.data;
    expect(d.email).toBe("defaults@example.test");
    expect(d.deliverability).toBe("UNKNOWN");
    expect(d.qualityScore).toBe(0);
    expect(d.isValidFormat).toBe(false);
  });

  it("reports its error object, HTTP failure and timeout", async () => {
    process.env.ABSTRACT_API_KEY = "k";
    stub([["emailvalidation.abstractapi.com", resp(200, { error: { message: "Quota" } })]]);
    expect((await (await lookup()).json()).abstract.error).toBe("Quota");

    stub([["emailvalidation.abstractapi.com", resp(402, {})]]);
    expect((await (await lookup()).json()).abstract.error).toBe("HTTP 402");

    stub([["emailvalidation.abstractapi.com", timeout]]);
    expect((await (await lookup()).json()).abstract.error).toBe("timed out");
  });
});

describe("Hunter.io", () => {
  it("normalises the verifier result", async () => {
    process.env.HUNTER_API_KEY = "k";
    stub([["api.hunter.io", resp(200, {
      data: {
        result: "deliverable", score: 97, regexp: true, gibberish: false, disposable: false,
        webmail: true, mx_records: true, smtp_server: true, smtp_check: true,
        accept_all: false, block: false,
      },
    })]]);
    const d = (await (await lookup()).json()).hunter.data;
    expect(d.result).toBe("deliverable");
    expect(d.score).toBe(97);
    expect(d.mxRecords).toBe(true);
  });

  it("defaults a response with no data block", async () => {
    process.env.HUNTER_API_KEY = "k";
    stub([["api.hunter.io", resp(200, {})]]);
    const d = (await (await lookup()).json()).hunter.data;
    expect(d.result).toBe("unknown");
    expect(d.score).toBe(0);
    expect(d.block).toBe(false);
  });

  it("surfaces Hunter's own error detail", async () => {
    process.env.HUNTER_API_KEY = "k";
    stub([["api.hunter.io", resp(200, { errors: [{ id: "wrong_auth", details: "Invalid API key" }] })]]);
    expect((await (await lookup()).json()).hunter.error).toBe("Invalid API key");
  });

  it("reports HTTP failure and timeout", async () => {
    process.env.HUNTER_API_KEY = "k";
    stub([["api.hunter.io", resp(401, {})]]);
    expect((await (await lookup()).json()).hunter.error).toBe("HTTP 401");

    stub([["api.hunter.io", timeout]]);
    expect((await (await lookup()).json()).hunter.error).toBe("timed out");
  });
});

describe("XposedOrNot (free breach DB)", () => {
  const breach = {
    breach: "Collection1", xposed_data: "Emails;Passwords;Names", xposed_date: "2019",
    xposed_records: 772904991, domain: "various", password_risk: "plaintext", verified: 1,
  };

  it("parses breaches, password risk and yearwise counts", async () => {
    stub([["api.xposedornot.com", resp(200, {
      BreachMetrics: { count: 1, yearwise_details: [{ y2019: 1 }, { y2020: 2 }] },
      ExposedBreaches: { breaches_details: [breach] },
    })]]);
    const d = (await (await lookup()).json()).xon.data;
    expect(d.breachCount).toBe(1);
    expect(d.breaches[0].xposedData).toEqual(["Emails", "Passwords", "Names"]);
    expect(d.breaches[0].passwordRisk).toBe("ClearText");
    expect(d.breaches[0].verified).toBe(true);
    expect(d.yearwiseDetails).toEqual({ y2019: 1, y2020: 2 });
    // No BreachMetrics tree → data types collected from the per-breach strings.
    expect(d.xposedDataTypes).toEqual(["Emails", "Passwords", "Names"]);
  });

  it("maps every password-risk value", async () => {
    const cases: Array<[string | undefined, string]> = [
      ["plaintext", "ClearText"], ["easytocrack", "EasyToCrack"],
      ["hardtocrack", "StrongHash"], ["something-else", "Unknown"], [undefined, "Unknown"],
    ];
    for (const [raw, expected] of cases) {
      stub([["api.xposedornot.com", resp(200, {
        ExposedBreaches: { breaches_details: [{ ...breach, password_risk: raw }] },
      })]]);
      const d = (await (await lookup()).json()).xon.data;
      expect(d.breaches[0].passwordRisk, String(raw)).toBe(expected);
    }
  });

  it("flattens the nested xposed_data category tree when present", async () => {
    stub([["api.xposedornot.com", resp(200, {
      BreachMetrics: {
        count: 1,
        xposed_data: [{
          children: [
            { name: "data_Email addresses" },
            { name: "ignored_not_a_leaf", children: [{ name: "data_Passwords" }] },
          ],
        }],
      },
      ExposedBreaches: { breaches_details: [breach] },
    })]]);
    const d = (await (await lookup()).json()).xon.data;
    expect(d.xposedDataTypes).toEqual(["Email addresses", "Passwords"]);
  });

  it("accepts a single root object as well as an array", async () => {
    stub([["api.xposedornot.com", resp(200, {
      BreachMetrics: { count: 1, xposed_data: { group: { name: "data_Phone numbers" } } },
      ExposedBreaches: { breaches_details: [breach] },
    })]]);
    expect((await (await lookup()).json()).xon.data.xposedDataTypes).toEqual(["Phone numbers"]);
  });

  it("survives deeply nested / cyclic-looking trees without hanging", async () => {
    // 30 levels — past the depth guard, so the deepest leaf is not collected.
    let node: Record<string, unknown> = { name: "data_TooDeep" };
    for (let i = 0; i < 30; i++) node = { children: [node] };
    stub([["api.xposedornot.com", resp(200, {
      BreachMetrics: { count: 1, xposed_data: node },
      ExposedBreaches: { breaches_details: [breach] },
    })]]);
    const d = (await (await lookup()).json()).xon.data;
    expect(d.xposedDataTypes).not.toContain("TooDeep");
  });

  it("defaults missing breach fields", async () => {
    stub([["api.xposedornot.com", resp(200, {
      ExposedBreaches: { breaches_details: [{}] },
    })]]);
    const b = (await (await lookup()).json()).xon.data.breaches[0];
    expect(b).toEqual({
      breach: "Unknown", xposedData: [], xposedDate: "Unknown",
      xposedRecords: 0, domain: "", passwordRisk: "Unknown", verified: false,
    });
  });

  it("treats an Error field, an empty breach list and a 404 as 'clean'", async () => {
    for (const body of [{ Error: "Not found" }, { ExposedBreaches: { breaches_details: [] } }, {}]) {
      stub([["api.xposedornot.com", resp(200, body)]]);
      const d = (await (await lookup()).json()).xon.data;
      expect(d.breachCount).toBe(0);
      expect(d.breaches).toEqual([]);
    }
    stub([["api.xposedornot.com", resp(404, {})]]);
    expect((await (await lookup()).json()).xon.data.breachCount).toBe(0);
  });

  it("reports rate limiting, HTTP failure and timeout", async () => {
    stub([["api.xposedornot.com", resp(429, {})]]);
    expect((await (await lookup()).json()).xon.error).toBe("RATE_LIMITED");

    stub([["api.xposedornot.com", resp(500, {})]]);
    expect((await (await lookup()).json()).xon.error).toBe("HTTP 500");

    stub([["api.xposedornot.com", timeout]]);
    expect((await (await lookup()).json()).xon.error).toBe("timed out");
  });
});

describe("FullContact (email)", () => {
  it("normalises a person record and excludes the queried address", async () => {
    process.env.FULLCONTACT_API_KEY = "k";
    stub([["api.fullcontact.com", resp(200, {
      fullName: "Jo Blogs", age: 33, gender: "Male", location: "NYC",
      title: "Eng", organization: "Acme", bio: "b", avatar: "https://a.test/p.png",
      details: {
        profiles: { github: { url: "https://gh.test/jo", username: "jo" }, noUrl: {} },
        emails: [{ value: "fc@example.test" }, { value: "other@x.test" }, {}],
        phones: [{ value: "+15551230000" }, {}],
        employment: [{ name: "Acme", title: "Eng", current: true }, { title: "nameless" }],
      },
    })]]);
    const d = (await (await lookup("fc@example.test")).json()).fullContact.data;
    expect(d.fullName).toBe("Jo Blogs");
    expect(d.profiles).toEqual([{ platform: "Github", url: "https://gh.test/jo", username: "jo" }]);
    expect(d.otherEmails).toEqual(["other@x.test"]); // queried address filtered out
    expect(d.phones).toEqual(["+15551230000"]);
    expect(d.employment).toEqual([{ name: "Acme", title: "Eng", current: true }]);
  });

  it("nulls every absent field", async () => {
    process.env.FULLCONTACT_API_KEY = "k";
    stub([["api.fullcontact.com", resp(200, {})]]);
    const d = (await (await lookup()).json()).fullContact.data;
    expect(d).toMatchObject({ fullName: null, age: null, profiles: [], otherEmails: [] });
  });

  it("maps 404, 422 and the sentinel message to NOT_FOUND", async () => {
    process.env.FULLCONTACT_API_KEY = "k";
    for (const status of [404, 422]) {
      stub([["api.fullcontact.com", resp(status, {})]]);
      expect((await (await lookup()).json()).fullContact.error, String(status)).toBe("NOT_FOUND");
    }
    stub([["api.fullcontact.com", resp(200, { message: "Unable to process request" })]]);
    expect((await (await lookup()).json()).fullContact.error).toBe("NOT_FOUND");
  });

  it("reports rate limiting, HTTP failure and timeout", async () => {
    process.env.FULLCONTACT_API_KEY = "k";
    stub([["api.fullcontact.com", resp(429, {})]]);
    expect((await (await lookup()).json()).fullContact.error).toBe("RATE_LIMITED");

    stub([["api.fullcontact.com", resp(500, {})]]);
    expect((await (await lookup()).json()).fullContact.error).toBe("HTTP 500");

    stub([["api.fullcontact.com", timeout]]);
    expect((await (await lookup()).json()).fullContact.error).toBe("timed out");
  });
});

describe("BreachDirectory (email)", () => {
  it("returns hits, and defaults a sparse response", async () => {
    process.env.RAPIDAPI_KEY = "k";
    stub([["breachdirectory.p.rapidapi.com", resp(200, {
      found: 2, fields: ["password"], sources: ["Leak"],
      result: [{ password: "p", sha1: "s", hash: "h", sources: ["Leak"] }],
    })]]);
    expect((await (await lookup()).json()).breachDirectory.data.found).toBe(2);

    stub([["breachdirectory.p.rapidapi.com", resp(200, { found: 1, result: [{}] })]]);
    const d = (await (await lookup()).json()).breachDirectory.data;
    expect(d.results[0]).toEqual({ password: "", sha1: "", hash: "", sources: [] });
  });

  it("treats 404 and found:0 as a clean answer", async () => {
    process.env.RAPIDAPI_KEY = "k";
    stub([["breachdirectory.p.rapidapi.com", resp(404, {})]]);
    expect((await (await lookup()).json()).breachDirectory.data.found).toBe(0);

    stub([["breachdirectory.p.rapidapi.com", resp(200, { found: 0 })]]);
    expect((await (await lookup()).json()).breachDirectory.data.found).toBe(0);
  });

  it("reports rate limiting, HTTP failure and timeout", async () => {
    process.env.RAPIDAPI_KEY = "k";
    stub([["breachdirectory.p.rapidapi.com", resp(429, {})]]);
    expect((await (await lookup()).json()).breachDirectory.error).toBe("RATE_LIMITED");

    stub([["breachdirectory.p.rapidapi.com", resp(500, {})]]);
    expect((await (await lookup()).json()).breachDirectory.error).toBe("HTTP 500");

    stub([["breachdirectory.p.rapidapi.com", timeout]]);
    expect((await (await lookup()).json()).breachDirectory.error).toBe("timed out");
  });
});

describe("uniform source health", () => {
  it("reports all eleven email sources, skipping the unconfigured ones", async () => {
    stub([]);
    const health = (await (await lookup()).json()).sourceHealth as Array<{ source: string; skipped?: boolean }>;
    expect(health.map((h) => h.source).sort()).toEqual([
      "abstract", "breachDirectory", "comb", "emailrep", "fullContact", "gravatar",
      "hibp", "hudsonRock", "hunter", "leakCheck", "xon",
    ]);
    // Keyless: Gravatar, XposedOrNot, Hudson Rock, LeakCheck and ProxyNova COMB
    // all run; the six keyed ones (now including HIBP) are skipped.
    expect(health.filter((h) => h.skipped).map((h) => h.source).sort()).toEqual([
      "abstract", "breachDirectory", "emailrep", "fullContact", "hibp", "hunter",
    ]);
  });
});

describe("ProxyNova COMB: masked credential exposure", () => {
  it("keeps only exact-login pairs and drives the credential-exposure block", async () => {
    // COMB returns fuzzy filler plus one exact match; only the exact one counts.
    stub([["api.proxynova.com", resp(200, {
      count: 10000,
      lines: [
        "comb-target@example.test:hunter2",
        "someoneelse@x.com:nope",   // fuzzy substring hit → dropped
      ],
    })]]);
    const json = (await (await lookup("comb-target@example.test")).json()) as {
      comb: { ok: boolean; data: { pairs: number; distinctPasswords: number; samples: string[] } };
      credentialExposure: { exposed: boolean; pairs: number; samples: string[] };
    };
    expect(json.comb.data.pairs).toBe(1);
    expect(json.comb.data.samples).toEqual(["h*****2"]);   // masked, never cleartext
    expect(json.credentialExposure.exposed).toBe(true);
    expect(json.credentialExposure.pairs).toBe(1);
  });

  it("treats a fuzzy-only page as clean, never a false positive", async () => {
    stub([["api.proxynova.com", resp(200, { count: 10000, lines: ["9931@wes.com:9931"] })]]);
    const json = (await (await lookup()).json()) as { comb: { data: { pairs: number } } };
    expect(json.comb.data.pairs).toBe(0);
  });

  it("degrades to breach-only evidence when COMB is rate-limited", async () => {
    // A failed COMB (no data) must not read as clean — credential exposure then
    // rests on the breach password count alone.
    stub([["api.proxynova.com", resp(429, {})]]);
    const json = (await (await lookup()).json()) as {
      comb: { ok: boolean; error: string };
      credentialExposure: { exposed: boolean; pairs: number };
    };
    expect(json.comb.ok).toBe(false);
    expect(json.comb.error).toBe("RATE_LIMITED");
    expect(json.credentialExposure.pairs).toBe(0);
    expect(json.credentialExposure.exposed).toBe(false);
  });

  it("counts Hudson Rock's exact-match infostealer captures as exposure", async () => {
    // No COMB, no breaches — only a Cavalier search-by-email infection with
    // masked captured passwords. It's an exact-identifier match, so it enriches
    // the exposure view where COMB (email-substring) has nothing.
    stub([["cavalier.hudsonrock.com", resp(200, {
      stealers: [
        { computer_name: "PC", top_passwords: ["I********6", "a***b"], top_logins: ["x@y.com"] },
        { computer_name: "PC2", top_passwords: ["a***b"], top_logins: ["z@y.com"] },
      ],
    })]]);
    const json = (await (await lookup()).json()) as {
      credentialExposure: { exposed: boolean; pairs: number; stealerLogs: number; stealerPasswords: number; reuse: string };
    };
    expect(json.credentialExposure.exposed).toBe(true);
    expect(json.credentialExposure.pairs).toBe(0);           // no COMB
    expect(json.credentialExposure.stealerLogs).toBe(2);
    expect(json.credentialExposure.stealerPasswords).toBe(2); // masked duplicate deduped
    expect(json.credentialExposure.reuse).toBe("none");       // masked data never claims reuse
  });
});

describe("server-computed breach union", () => {
  it("enriches a name-only LeakCheck breach from the offline catalog", async () => {
    // LeakCheck names "Adobe" with no data classes; the vendored HIBP catalog
    // fills them in, so the union carries passwords the free source never sent.
    stub([["leakcheck.io", resp(200, {
      success: true, found: 1, fields: [], sources: [{ name: "Adobe", date: "2013-10-04" }],
    })]]);
    const json = (await (await lookup()).json()) as {
      breachAggregate: { total: number; enrichedCount: number; withPassword: number; breaches: Array<{ name: string; enriched: boolean; dataClasses: string[] }> };
    };
    const agg = json.breachAggregate;
    expect(agg.total).toBeGreaterThanOrEqual(1);
    const adobe = agg.breaches.find((b) => b.name === "Adobe");
    expect(adobe?.enriched).toBe(true);
    expect(adobe?.dataClasses).toContain("Passwords");
    expect(agg.withPassword).toBeGreaterThanOrEqual(1);
    expect(agg.enrichedCount).toBeGreaterThanOrEqual(1);
  });
});
