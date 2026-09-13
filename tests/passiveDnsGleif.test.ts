import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchPassiveDns, fetchReverseIp, PDNS_SOURCE, REVERSE_IP_SOURCE } from "@/lib/server/passiveDns";
import { fetchLei, GLEIF_SOURCE } from "@/lib/server/gleif";
import { resetBudgets } from "@/lib/server/upstreamBudget";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetBudgets(); });

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(),
  json: async () => body,
}) as unknown as Response;

const text = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(),
  text: async () => body,
}) as unknown as Response;

const row = (over: Record<string, unknown> = {}) => ({
  query: "example.test", answer: "1.2.3.4", rrtype: "a", times: 5,
  firstSeenTimestamp: 1_600_000_000_000, lastSeenTimestamp: 1_700_000_000_000,
  createdTimestamp: 1_500_000_000_000, lastUpdatedTimestamp: 1_650_000_000_000,
  ...over,
});

describe("fetchPassiveDns", () => {
  it("normalises the records and reports how many the source holds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, {
      responseCode: 200, count: 1000,
      data: [row(), row({ answer: "::1", rrtype: "aaaa", firstSeenTimestamp: 0, lastSeenTimestamp: 0 })],
    })));
    const { result, provenance } = await fetchPassiveDns("example.test");
    expect(provenance.ok).toBe(true);
    expect(provenance.source).toBe(PDNS_SOURCE);
    expect(result!.total).toBe(1000);
    expect(result!.capped).toBe(true);
    expect(result!.degraded).toBe(false);
    expect(result!.records[0]).toEqual({
      query: "example.test", answer: "1.2.3.4", rrtype: "A",
      firstSeen: "2020-09-13", lastSeen: "2023-11-14", times: 5,
    });
    // Missing first/last-seen falls back to the source's own row timestamps.
    expect(result!.records[1].firstSeen).toBe("2017-07-14");
  });

  it("retries a flattened response, and takes the good one", async () => {
    // The anonymous tier sometimes zeroes every timestamp and reports every
    // record as an A. That is not thin data, it is WRONG data.
    const degraded = { responseCode: 200, count: 9, data: Array.from({ length: 6 }, () =>
      row({ rrtype: "a", firstSeenTimestamp: 0, lastSeenTimestamp: 0, answer: "::1" })) };
    const good = { responseCode: 200, count: 9, data: [row({ rrtype: "cname", answer: "host.test" })] };
    const fetchSpy = vi.fn(async () => json(200, fetchSpy.mock.calls.length === 1 ? degraded : good));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = await fetchPassiveDns("example.test");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result!.degraded).toBe(false);
    expect(result!.records[0].rrtype).toBe("CNAME");
  });

  it("keeps only the record types the answer itself proves when flattening persists", async () => {
    const degraded = {
      responseCode: 200, count: 3,
      data: [
        row({ rrtype: "a", answer: "1.2.3.4", firstSeenTimestamp: 0, lastSeenTimestamp: 0 }),
        row({ rrtype: "a", answer: "2606:4700::1", firstSeenTimestamp: 0, lastSeenTimestamp: 0 }),
        row({ rrtype: "a", answer: "host.test", firstSeenTimestamp: 0, lastSeenTimestamp: 0 }),
        row({ rrtype: "a", answer: "x.test", firstSeenTimestamp: 0, lastSeenTimestamp: 0 }),
        row({ rrtype: "a", answer: "y.test", firstSeenTimestamp: 0, lastSeenTimestamp: 0 }),
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => json(200, degraded)));
    const { result } = await fetchPassiveDns("example.test");
    expect(result!.degraded).toBe(true);
    expect(result!.records.map((r) => r.rrtype)).toEqual(["A", "AAAA", "UNKNOWN", "UNKNOWN", "UNKNOWN"]);
    // The create/update stamps stand in for the zeroed first/last-seen.
    expect(result!.records[0].firstSeen).toBe("2017-07-14");
  });

  it("returns null rather than an empty history when the source declines", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { responseCode: 402 })));
    const declined = await fetchPassiveDns("example.test");
    expect(declined.result).toBeNull();
    expect(declined.provenance.error).toMatch(/code 402/);

    vi.stubGlobal("fetch", vi.fn(async () => json(500, {})));
    const down = await fetchPassiveDns("example.test");
    expect(down.result).toBeNull();
    expect(down.provenance.ok).toBe(false);
  });

  it("drops rows with no answer at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { responseCode: 200, data: [{ query: "x" }, row()] })));
    const { result } = await fetchPassiveDns("example.test");
    expect(result!.records).toHaveLength(1);
    expect(result!.total).toBe(1);
    expect(result!.capped).toBe(false);
  });
});

describe("fetchReverseIp", () => {
  it("returns the hostnames, deduplicated and sorted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => text(200, "b.test\nA.TEST\na.test\n\nnot a host!\n")));
    const { hosts, provenance } = await fetchReverseIp("1.2.3.4");
    expect(hosts).toEqual(["a.test", "b.test"]);
    expect(provenance.source).toBe(REVERSE_IP_SOURCE);
    expect(provenance.ok).toBe(true);
  });

  it("reads a quota notice as a quota notice, not as a hostname", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => text(200, "API count exceeded - Increase Quota with Membership")));
    const first = await fetchReverseIp("1.2.3.4");
    expect(first.hosts).toBeNull();
    expect(first.provenance.error).toMatch(/quota exhausted/);

    // And the source is parked, so the next lookup does not spend a request.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const second = await fetchReverseIp("1.2.3.5");
    expect(second.hosts).toBeNull();
    expect(second.provenance.error).toMatch(/rate-limited/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports an HTTP failure and a network failure honestly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => text(503, "")));
    expect((await fetchReverseIp("1.2.3.4")).provenance.error).toMatch(/HTTP 503/);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const out = await fetchReverseIp("1.2.3.4");
    expect(out.hosts).toBeNull();
    expect(out.provenance.error).toMatch(/unreachable/);
  });
});

describe("fetchLei", () => {
  const record = (name: string) => ({
    attributes: {
      lei: "LBQ3CAGQB6M55WHL3G85",
      entity: {
        legalName: { name },
        legalAddress: { addressLines: ["1209 ORANGE ST"], city: "WILMINGTON", region: "US-DE", postalCode: "19801", country: "US" },
        headquartersAddress: {},
        registeredAs: "3014267",
        status: "ACTIVE",
      },
      registration: { status: "ISSUED" },
    },
  });

  it("flattens the register's answer and marks the exact name match", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, {
      meta: { pagination: { total: 76760 } },
      data: [record("SOMETHING ELSE INC"), record("PAYPAL, INC."), { attributes: {} }],
    })));
    const { outcome, provenance } = await fetchLei("PayPal, Inc.", "certificate");
    expect(provenance.source).toBe(GLEIF_SOURCE);
    expect(outcome!.source).toBe("certificate");
    // The exact match is first, because the register answers with word matches:
    // "PayPal, Inc." returns everything with "Inc" in its name.
    expect(outcome!.records[0].legalName).toBe("PAYPAL, INC.");
    expect(outcome!.records[0].exact).toBe(true);
    expect(outcome!.records[1].exact).toBe(false);
    expect(outcome!.records[0].legalAddress).toBe("1209 ORANGE ST, WILMINGTON, US-DE, 19801, US");
    expect(outcome!.records[0].headquartersAddress).toBeNull();
    expect(outcome!.total).toBe(76760);
  });

  // Measured against the live register on 2026-09-13: one lookup of paypal.com
  // returned PAYPAL, INC. (Delaware, LEI LBQ3CAGQB6M55WHL3G85), PAYPAL
  // HOLDINGS, INC. (Delaware, a different LEI) and PAYPAL LIMITED (Ireland, a
  // third), and the old key dropped every legal suffix, so all three collapsed
  // to "paypal" and all three were flagged as the exact match that names the
  // registrant. The panel prints an exact match as the identified company, so
  // that was three companies claimed for one domain.
  it("does not treat a parent, a subsidiary and a foreign arm as the same company", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, {
      data: [
        record("PAYPAL HOLDINGS, INC."),
        record("PAYPAL LIMITED"),
        record("PAYPAL, INC."),
      ],
    })));
    const { outcome } = await fetchLei("PayPal, Inc.", "certificate");
    const byName = Object.fromEntries(outcome!.records.map((r) => [r.legalName, r.exact]));
    expect(byName).toEqual({
      "PAYPAL, INC.": true,
      "PAYPAL HOLDINGS, INC.": false,
      "PAYPAL LIMITED": false,
    });
    // And the one true match is still what the panel and the report read first.
    expect(outcome!.records[0].legalName).toBe("PAYPAL, INC.");
  });

  // The suffix is normalised rather than dropped, so the formatting variance
  // this was meant to tolerate still matches: a CA writing "Incorporated" and a
  // register writing "Inc." are the same company.
  it("still matches a name whose suffix is spelled out differently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, {
      data: [record("Acme Incorporated"), record("Acme Limited")],
    })));
    const { outcome } = await fetchLei("ACME, INC.", "registrant");
    expect(outcome!.records[0].legalName).toBe("Acme Incorporated");
    expect(outcome!.records[0].exact).toBe(true);
    expect(outcome!.records[1].exact).toBe(false);
  });

  it("reports an empty register answer as empty, not as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { data: [] })));
    const { outcome, provenance } = await fetchLei("Nobody Ltd", "registrant");
    expect(provenance.ok).toBe(true);
    expect(outcome!.records).toEqual([]);
    expect(outcome!.total).toBe(0);
  });

  it("returns null when the register did not answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(502, null)));
    const { outcome, provenance } = await fetchLei("Anything", "registrant");
    expect(outcome).toBeNull();
    expect(provenance.ok).toBe(false);
  });
});
