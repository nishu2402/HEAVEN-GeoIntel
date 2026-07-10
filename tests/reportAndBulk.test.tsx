// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import ReportExport from "@/components/shared/ReportExport";
import BulkLookup from "@/components/dashboard/BulkLookup";
import type { LookupResponse, SourceResult } from "@/lib/types";

// ReportExport builds a full phone report string, so it needs a fairly complete
// LookupResponse; BulkLookup talks to /api/bulk-lookup and downloads a CSV.

const okSource = <T,>(data: T): SourceResult<T> => ({ ok: true, data });
const noSource = (error = "NOT_CONFIGURED"): SourceResult<never> => ({ ok: false, error });

// ── download capture (jsdom can't navigate) ──────────────────────────────────
const downloads: { name: string; type: string; body: string }[] = [];
let lastBlobText = "";
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

beforeEach(() => {
  downloads.length = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    // Blob.text() is async; capture synchronously from the parts we can read.
    (blob as Blob & { _capture?: boolean })._capture = true;
    return "blob:mock";
  });
  URL.revokeObjectURL = vi.fn();
  // Grab the text passed to each new Blob by wrapping the constructor.
  const RealBlob = globalThis.Blob;
  vi.stubGlobal("Blob", class extends RealBlob {
    constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
      super(parts, opts);
      lastBlobText = parts.map(String).join("");
    }
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, type: this.href, body: lastBlobText });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

// ── ReportExport ─────────────────────────────────────────────────────────────
const baseData = (over: Partial<LookupResponse> = {}): LookupResponse => ({
  input: { e164: "+14155552671", countryCallingCode: "1", isValid: true, isPossible: true } as never,
  aggregated: {
    country: "US", countryName: "United States", formatInternational: "+1 415-555-2671",
    formatNational: "(415) 555-2671", formatRfc3966: "tel:+1-415-555-2671",
    region: "California", city: "San Francisco", lineType: "mobile", typeDescription: "Mobile",
    isAmbiguousType: false, isMobile: true, isFixedLine: false, isVoip: false,
    carrier: "Verizon", prepaid: null, active: null, activeStatus: null, userActivity: null,
    mobileCountryCode: "310", mobileNetworkCode: "012", callerName: null, callerType: null,
    associatedEmails: null, fraudScore: 12, isRisky: false, recentAbuse: false, isDisposable: false,
    carrierPrefix: "415", numberLength: 10, timezone: ["America/Los_Angeles"], utcOffsets: ["UTC-08:00"],
  } as never,
  analysis: {
    npaInfo: { state: "California", stateAbbr: "CA", region: "Bay Area", timezone: "America/Los_Angeles" },
    nationalNumber: "4155552671", isTollFree: false, isPremiumRate: false,
    areaCode: "415", subscriberNumber: "5552671", expectedLengths: [10],
  } as never,
  sources: {
    numverify: okSource({}), ipqs: noSource(), abstract: noSource(), twilio: okSource({}),
    breachDirectory: noSource(), fullContact: noSource(), hudsonRock: noSource(),
  } as never,
  threatScore: 12, threatLabel: "LOW RISK",
  ...over,
}) as LookupResponse;

describe("<ReportExport>", () => {
  it("exports a TXT report named after the number and shows a SAVED confirmation", () => {
    vi.useFakeTimers();
    try {
      render(<ReportExport data={baseData()} />);
      fireEvent.click(screen.getByRole("button", { name: /export txt report/i }));
      expect(downloads).toHaveLength(1);
      expect(downloads[0]!.name).toMatch(/^geointel_14155552671_\d+\.txt$/);
      expect(downloads[0]!.body).toContain("HEAVEN-GeoIntel — Phone Intelligence Report");
      expect(downloads[0]!.body).toContain("Verizon");
      expect(screen.getByRole("button", { name: /saved/i })).toBeTruthy();
      act(() => { vi.advanceTimersByTime(2100); });
      expect(screen.getByRole("button", { name: /export txt report/i })).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it("exports an HTML report with the text escaped inside a <pre>", () => {
    vi.useFakeTimers();
    try {
      render(<ReportExport data={baseData()} />);
      fireEvent.click(screen.getByRole("button", { name: /export html report/i }));
      expect(downloads[0]!.name).toMatch(/\.html$/);
      expect(downloads[0]!.body).toContain("<!DOCTYPE html>");
      expect(downloads[0]!.body).toContain("─".repeat(70)); // separators survive escaping
      expect(screen.getByRole("button", { name: /saved/i })).toBeTruthy();
      act(() => { vi.advanceTimersByTime(2100); });
      expect(screen.getByRole("button", { name: /export html report/i })).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it("renders enrichment + breach sections and N/A fallbacks when data is present", () => {
    const rich = baseData({
      sources: {
        numverify: noSource("rate limited"), ipqs: noSource(), abstract: noSource(),
        twilio: noSource(), breachDirectory: okSource({ found: 2, sources: ["LinkedIn"], results: [
          { sources: ["LinkedIn"], password: "he**o", sha1: "abc", hash: "def" },
          { sources: [], password: "", sha1: "", hash: "" },
        ] }),
        fullContact: okSource({
          fullName: "Ada Lovelace", title: "Analyst", organization: "Acme", location: "SF",
          bio: "", age: 30, gender: "F", otherEmails: ["a@x.com"], phones: ["+1"],
          // second profile has no username → falls back to the URL
          profiles: [{ platform: "github", username: "ada", url: "" }, { platform: "tw", username: "", url: "https://tw/x" }],
          employment: [{ current: true, name: "Acme", title: "Analyst" }, { current: false, name: "Old", title: "" }],
        }),
        hudsonRock: noSource(),
      } as never,
    });
    render(<ReportExport data={rich} />);
    fireEvent.click(screen.getByRole("button", { name: /export txt report/i }));
    const body = downloads[0]!.body;
    expect(body).toContain("Ada Lovelace");
    expect(body).toContain("[CURRENT] Acme — Analyst");
    expect(body).toContain("[PAST] Old");
    expect(body).toContain("Records Found      : 2");
    expect(body).toContain("NumVerify         : ERROR — rate limited");
    expect(body).toContain("tw:https://tw/x"); // username-less profile falls back to URL
  });

  it("emits the 'no data' fallbacks when optional sources are unconfigured or empty", () => {
    const clean = baseData({
      sources: {
        numverify: okSource({}), ipqs: noSource(), abstract: noSource(), twilio: okSource({}),
        breachDirectory: okSource({ found: 0, sources: [], results: [] }),
        fullContact: noSource("NOT_FOUND"), hudsonRock: noSource(),
      } as never,
      aggregated: { ...baseData().aggregated, region: "San Francisco", city: "San Francisco", fraudScore: null,
        mobileCountryCode: null, mobileNetworkCode: null } as never,
    });
    render(<ReportExport data={clean} />);
    fireEvent.click(screen.getByRole("button", { name: /export txt report/i }));
    const body = downloads[0]!.body;
    expect(body).toContain("No record found");          // fullContact NOT_FOUND
    expect(body).toContain("CLEAN — no credential records found"); // breachDirectory found === 0
    expect(body).toContain("Fraud Score        : N/A"); // null fraud score
    expect(body).toContain("MCC / MNC          : N/A"); // both codes null
    // region === city → the "Region (API)" line is omitted
    expect(body).not.toContain("Region (API)");
  });

  it("covers the country-only path with no NPA data and a missing timezone", () => {
    const intl = baseData({
      aggregated: { ...baseData().aggregated, region: null, city: null, timezone: null, utcOffsets: null } as never,
      analysis: { ...baseData().analysis, npaInfo: null } as never,
    });
    render(<ReportExport data={intl} />);
    fireEvent.click(screen.getByRole("button", { name: /export txt report/i }));
    expect(downloads[0]!.body).toContain("Timezone           : N/A");
  });

  it("labels every unconfigured source as NOT CONFIGURED", () => {
    render(<ReportExport data={baseData({
      sources: {
        numverify: noSource(), ipqs: noSource(), abstract: noSource(), twilio: noSource(),
        breachDirectory: noSource(), fullContact: noSource(), hudsonRock: noSource(),
      } as never,
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /export txt report/i }));
    const body = downloads[0]!.body;
    expect(body).toContain("NumVerify         : NOT CONFIGURED");
    expect(body).toContain("Twilio Lookup     : NOT CONFIGURED");
    expect(body).toContain("BreachDirectory   : NOT CONFIGURED");
  });

  it("passes a non-NOT_CONFIGURED error straight through as ERROR for every source", () => {
    render(<ReportExport data={baseData({
      sources: {
        numverify: noSource("e1"), ipqs: noSource("e2"), abstract: noSource("e3"), twilio: noSource("e4"),
        breachDirectory: noSource("e5"), fullContact: noSource("e6"), hudsonRock: noSource(),
      } as never,
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /export txt report/i }));
    const body = downloads[0]!.body;
    expect(body).toContain("IPQualityScore    : ERROR — e2");
    expect(body).toContain("Twilio Lookup     : ERROR — e4");
    // fullContact + breachDirectory generic-error status lines (neither NOT_CONFIGURED nor NOT_FOUND/clean)
    expect(body).toContain("Status             : e6");
    expect(body).toContain("Status             : e5");
  });

  it("falls back to N/A for a failed source that carries no error string", () => {
    render(<ReportExport data={baseData({
      sources: {
        numverify: okSource({}), ipqs: noSource(), abstract: noSource(), twilio: okSource({}),
        breachDirectory: { ok: false } as never, // failed, but no `error`
        fullContact: { ok: false } as never,
        hudsonRock: noSource(),
      } as never,
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /export txt report/i }));
    const body = downloads[0]!.body;
    // both status lines resolve their `error ?? "N/A"` to N/A
    expect(body.match(/Status             : N\/A/g)?.length).toBe(2);
  });

  it("handles empty enrichment collections without emitting stray rows", () => {
    render(<ReportExport data={baseData({
      aggregated: { ...baseData().aggregated, associatedEmails: [], isAmbiguousType: true } as never,
      analysis: { ...baseData().analysis, expectedLengths: [] } as never,
      sources: {
        // ipqs + abstract ACTIVE here so their ok-branch is exercised too
        numverify: okSource({}), ipqs: okSource({}), abstract: okSource({}), twilio: okSource({}),
        breachDirectory: okSource({ found: 3, sources: [], results: [] }), // found > 0 but no named sources
        fullContact: okSource({
          fullName: "Nobody", title: null, organization: null, location: null, bio: null,
          age: null, gender: null, otherEmails: [], phones: [],
          profiles: [], employment: [], // both empty → the omitted-branch paths
        }),
        hudsonRock: noSource(),
      } as never,
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /export txt report/i }));
    const body = downloads[0]!.body;
    expect(body).toContain("Associated Emails  : N/A"); // val([]) → "N/A"
    expect(body).toContain("Social Profiles    : N/A"); // empty profiles
    expect(body).toContain("Sources            : N/A"); // found>0 but empty sources
    expect(body).toContain("Expected Length    : N/A"); // empty expectedLengths
    expect(body).toContain("(mobile/landline unresolvable"); // isAmbiguousType true
    expect(body).not.toContain("Employment:");            // empty employment omitted
  });
});

// ── BulkLookup ───────────────────────────────────────────────────────────────
interface BulkRow {
  input: string; ok: boolean; error?: string; e164?: string; country?: string | null;
  type?: string | null; carrier?: string | null; utcOffset?: string | null;
  npaState?: string | null; npaRegion?: string | null; cached?: boolean;
}
const row = (over: Partial<BulkRow> = {}): BulkRow => ({
  input: "+14155552671", ok: true, e164: "+14155552671", country: "US",
  type: "mobile", carrier: "Verizon", utcOffset: "UTC-08:00", npaState: "CA", npaRegion: "Bay Area",
  ...over,
});

describe("<BulkLookup>", () => {
  const type = (text: string) => fireEvent.change(screen.getByLabelText(/bulk phone-number input/i), { target: { value: text } });
  const runBtn = () => screen.getByRole("button", { name: /run bulk/i });

  it("disables RUN until at least one number is present", () => {
    render(<BulkLookup />);
    expect(runBtn()).toHaveProperty("disabled", true);
    type("+14155552671");
    expect(runBtn()).toHaveProperty("disabled", false);
    expect(screen.getByText(/run bulk \(1\)/i)).toBeTruthy();
  });

  it("blocks and warns past the 25-number cap", () => {
    render(<BulkLookup />);
    type(Array.from({ length: 26 }, (_, i) => `+1415555${String(i).padStart(4, "0")}`).join("\n"));
    expect(screen.getByText(/26 pasted — max is 25/i)).toBeTruthy();
    expect(runBtn()).toHaveProperty("disabled", true);
  });

  it("runs a batch, renders the results table, and downloads a formula-safe CSV", async () => {
    const rows = [
      // an all-null row exercises every `?? "—"` cell fallback and the region-less branch
      row({ input: "carrier, inc", type: null, carrier: null, utcOffset: null, npaRegion: null, npaState: null }),
      row({ input: "+14155552672" }), // full NPA → "Bay Area, CA" (region + state)
      row({ input: "bad", ok: false, error: "invalid", e164: undefined, country: null, npaRegion: "Metro only", npaState: null, cached: true }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ count: 3, rows }) }) as Response));
    render(<BulkLookup />);
    type("+14155552671\n+14155552672\nbad");
    await act(async () => { fireEvent.click(runBtn()); });

    expect(screen.getByText(/✓ 2 OK/)).toBeTruthy();
    expect(screen.getByText(/✗ 1 failed/)).toBeTruthy();
    expect(screen.getByText("Bay Area, CA")).toBeTruthy(); // region + state
    expect(screen.getByText("Metro only")).toBeTruthy();   // npaRegion without npaState
    expect(screen.getByText("[c]")).toBeTruthy();           // cached marker
    expect(screen.getByText("invalid")).toBeTruthy();       // per-row error

    fireEvent.click(screen.getByRole("button", { name: /download csv/i }));
    const csv = downloads[0]!.body;
    expect(csv.split("\n")[0]).toMatch(/^input,ok,error,e164/);
    expect(csv).toContain("'+14155552671");    // leading + escaped against formula injection
    expect(csv).toContain('"carrier, inc"');    // comma-bearing cell gets quoted
  });

  it("shows a server-provided error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: "Rate limited" }) }) as Response));
    render(<BulkLookup />);
    type("+14155552671");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText("Rate limited")).toBeTruthy();
  });

  it("falls back to the HTTP status when the error body omits a message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
    render(<BulkLookup />);
    type("+14155552671");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText(/HTTP 500/)).toBeTruthy();
  });

  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    render(<BulkLookup />);
    type("+14155552671");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText(/network error/i)).toBeTruthy();
  });

  it("handles a 200 response that omits the rows array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) }) as Response));
    render(<BulkLookup />);
    type("+14155552671");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText(/HTTP 200/)).toBeTruthy();
  });
});
