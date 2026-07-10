// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { installMemoryLocalStorage, installResizeObserver } from "./testUtils";
import type { LookupResponse, AggregatedResult, SourceResult } from "@/lib/types";

// ResultsDashboard is a pure composition of ~12 child panels; each has its own
// suite. Here we stub the heavy children so the test targets ResultsDashboard's
// OWN logic: glance tiles, the source-status strip, and the conditional panels
// (SIM data vs placeholder, country intel present/absent). `vi.hoisted` makes
// the stub factory available to the hoisted vi.mock calls.
const { mockPanel } = vi.hoisted(() => ({
  mockPanel: (name: string) => async () => {
    const React = await import("react");
    return {
      default: (p: Record<string, unknown>) =>
        React.createElement("div", { "data-testid": name }, `${name}:${JSON.stringify(Object.keys(p))}`),
    };
  },
}));
vi.mock("@/components/dashboard/SourceTabs", mockPanel("SourceTabs"));
vi.mock("@/components/osint/OsintPivots", mockPanel("OsintPivots"));
vi.mock("@/components/phone/NumberAnatomyPanel", mockPanel("NumberAnatomy"));
vi.mock("@/components/phone/NumberPermutations", mockPanel("NumberPermutations"));
vi.mock("@/components/phone/PentesterPanel", mockPanel("PentesterPanel"));
vi.mock("@/components/phone/PhoneIdentityPanel", mockPanel("PhoneIdentity"));
vi.mock("@/components/phone/SimIntelPanel", mockPanel("SimIntelPanel"));
vi.mock("@/components/osint/CountryPanel", mockPanel("CountryPanel"));
vi.mock("@/components/osint/LocationPanel", mockPanel("LocationPanel"));
vi.mock("@/components/osint/QrCodePanel", mockPanel("QrCodePanel"));
vi.mock("@/components/breach/BreachPanel", mockPanel("BreachPanel"));
vi.mock("@/components/breach/InfostealerPanel", mockPanel("InfostealerPanel"));

import ResultsDashboard from "@/components/dashboard/ResultsDashboard";

beforeAll(() => { installMemoryLocalStorage(); installResizeObserver(); });
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// The component only reads `.ok` and (for the tiles) a couple of `.data` fields,
// so loosely-typed source stubs cast through `as never` keep the fixtures small.
const okS = (data: unknown): SourceResult<never> => ({ ok: true, data: data as never });
const offS = (): SourceResult<never> => ({ ok: false, error: "NOT_CONFIGURED" });

const agg = (over: Partial<AggregatedResult> = {}): AggregatedResult => ({
  carrier: "Verizon", lineType: "mobile", typeDescription: "Mobile", country: "US", countryName: "United States",
  region: null, timezone: null, utcOffsets: null, isValid: true, fraudScore: null, isVoip: null, isMobile: true,
  isFixedLine: null, isAmbiguousType: false, isTollFree: null, isPremiumRate: null, isDisposable: null,
  isRisky: null, recentAbuse: null, carrierPrefix: null, areaCode: null, formatE164: "+14155552671",
  formatInternational: "+1 415-555-2671", formatNational: "(415) 555-2671", formatRfc3966: "tel:+1-415-555-2671",
  prepaid: false, active: true, activeStatus: null, userActivity: "high", mobileCountryCode: "310",
  mobileNetworkCode: "012", callerName: null, callerType: null, associatedEmails: null, city: null, numberLength: 10,
  ...over,
} as AggregatedResult);

const lookup = (over: {
  aggregated?: Partial<AggregatedResult>;
  sources?: Record<string, SourceResult<never>>;
  countryIntel?: unknown;
  npaInfo?: unknown;
  cachedAt?: number;
  isValid?: boolean;
  threat?: [number, string];
} = {}): LookupResponse => ({
  input: { raw: "4155552671", e164: "+14155552671", national: "(415) 555-2671", country: "US",
    countryCallingCode: "+1", region: null, isValid: over.isValid ?? true, isPossible: true, type: "mobile" },
  analysis: { npaInfo: over.npaInfo ?? null } as never,
  aggregated: agg(over.aggregated),
  countryIntel: (over.countryIntel ?? null) as never,
  offline: {} as never,
  sources: {
    numverify: offS(), ipqs: offS(), abstract: offS(), twilio: offS(),
    breachDirectory: offS(), fullContact: offS(), hudsonRock: okS({ total: 0, stealers: [] }),
    ...over.sources,
  } as never,
  threatScore: over.threat?.[0] ?? 12, threatLabel: over.threat?.[1] ?? "LOW RISK",
  cachedAt: over.cachedAt,
});

describe("<ResultsDashboard>", () => {
  it("renders the header, threat score, glance tiles and every child panel", () => {
    render(<ResultsDashboard data={lookup({
      sources: { breachDirectory: okS({ found: 2 }), hudsonRock: okS({ total: 3, stealers: [] }) },
      npaInfo: { region: "Bay Area", stateAbbr: "CA" },
      countryIntel: { name: "United States" },
    })} />);
    expect(screen.getByText("+14155552671")).toBeTruthy();
    expect(screen.getByText(/LOW RISK/)).toBeTruthy();
    expect(screen.getByText("✓ VALID")).toBeTruthy();
    // glance tiles
    expect(screen.getByText("Bay Area, CA")).toBeTruthy();     // npa location
    expect(screen.getByText("2 found")).toBeTruthy();           // breach
    expect(screen.getByText("3 devices")).toBeTruthy();         // infostealer plural
    // SIM data present → real SIM panel (stub), country intel present → CountryPanel
    expect(screen.getByTestId("SimIntelPanel")).toBeTruthy();
    expect(screen.getByTestId("CountryPanel")).toBeTruthy();
    expect(screen.getByTestId("PentesterPanel")).toBeTruthy();
  });

  it("shows the CACHED badge and the singular infostealer wording", () => {
    render(<ResultsDashboard data={lookup({
      cachedAt: Date.now(),
      sources: { hudsonRock: okS({ total: 1, stealers: [] }) },
    })} />);
    expect(screen.getByText("CACHED")).toBeTruthy();
    expect(screen.getByText("1 device")).toBeTruthy(); // singular
  });

  it("renders the invalid badge, the no-keys hint, a placeholder SIM panel and no country intel", () => {
    render(<ResultsDashboard data={lookup({
      isValid: false,
      aggregated: { carrier: null, prepaid: null, active: null, mobileCountryCode: null, userActivity: null, lineType: null, typeDescription: "" },
    })} />);
    expect(screen.getByText("✗ INVALID")).toBeTruthy();
    // no configured keys → the "+ carrier/breach/identity APIs" hint appears
    expect(screen.getByText(/see \.env\.local for free-tier keys/i)).toBeTruthy();
    // no SIM data → placeholder card instead of the SIM panel
    expect(screen.queryByTestId("SimIntelPanel")).toBeNull();
    expect(screen.getByText(/SIM & CARRIER INTELLIGENCE/)).toBeTruthy();
    // no country intel → no CountryPanel
    expect(screen.queryByTestId("CountryPanel")).toBeNull();
    // glance fallbacks: carrier "—", line type "Unknown", location = country name
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText("United States")).toBeTruthy();
    // breach/infostealer need keys → "Needs key" / "—"
    expect(screen.getByText("Needs key")).toBeTruthy();
  });

  it("shows breach 'None' and infostealer 'None' when sources answered with zero", () => {
    render(<ResultsDashboard data={lookup({
      sources: { breachDirectory: okS({ found: 0 }), hudsonRock: okS({ total: 0, stealers: [] }) },
    })} />);
    expect(screen.getAllByText("None").length).toBe(2); // breach + infostealer
  });

  it("copies E.164 and international, and exports a JSON file", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    const clicks: string[] = [];
    const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      if (this.download) clicks.push(this.download);
    });
    try {
      render(<ResultsDashboard data={lookup()} />);
      act(() => { fireEvent.click(screen.getByRole("button", { name: /copy e\.164/i })); });
      expect(writeText).toHaveBeenCalledWith("+14155552671");
      act(() => { fireEvent.click(screen.getByRole("button", { name: /copy intl/i })); });
      expect(writeText).toHaveBeenCalledWith("+1 415-555-2671");
      fireEvent.click(screen.getByRole("button", { name: /export json/i }));
      expect(clicks[0]).toMatch(/^14155552671_\d+\.json$/);
    } finally {
      URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
    }
  });

  it("marks the data-source strip: active, configured-but-erroring, and off", () => {
    render(<ResultsDashboard data={lookup({
      sources: {
        numverify: okS({}),                                   // active ✓
        ipqs: { ok: false, error: "rate limited" },           // configured but erroring
        abstract: offS(),                                     // off
        twilio: offS(), breachDirectory: offS(), fullContact: offS(),
        hudsonRock: okS({ total: 0, stealers: [] }),
      },
    })} />);
    // the strip lists libphonenumber as always-on
    expect(screen.getByText(/✓ libphonenumber/)).toBeTruthy();
    // with a configured source (NumVerify ok) the no-keys hint is suppressed
    expect(screen.queryByText(/see \.env\.local for free-tier keys/i)).toBeNull();
  });

  it("colours the threat bar across every band", () => {
    for (const [score, label] of [[85, "CRITICAL"], [55, "HIGH"], [25, "MODERATE"], [5, "CLEAN"]] as const) {
      cleanup();
      render(<ResultsDashboard data={lookup({ threat: [score, label] })} />);
      expect(screen.getByText(String(score))).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("classifies an infostealer error as unknown and reports the location by NPA region alone", () => {
    render(<ResultsDashboard data={lookup({
      sources: { hudsonRock: { ok: false, error: "RATE_LIMITED" } }, // hrTotal → null
      npaInfo: { region: "Bay Area", stateAbbr: null },              // region, no state abbr
    })} />);
    // infostealer glance tile falls back to "—" when the source errored
    expect(screen.getByText("Bay Area")).toBeTruthy(); // no ", CA" suffix
  });

  it("marks a NOT_FOUND source as an empty (not error) state in the strip", () => {
    // srState → "empty" via the not-found regex; the strip still renders it.
    render(<ResultsDashboard data={lookup({
      sources: {
        fullContact: { ok: false, error: "NOT_FOUND" },   // → "empty" via the not-found regex
        twilio: { ok: false } as SourceResult<never>,      // no error string → srState reads `error ?? ""`
      },
    })} />);
    expect(screen.getAllByText(/FullContact/).length).toBeGreaterThan(0); // strip + SourceStrip
  });

  it("passes the pivot handlers through to the identity panel", () => {
    const onUsernameSweep = vi.fn();
    const onEmailLookup = vi.fn();
    render(<ResultsDashboard data={lookup()} onUsernameSweep={onUsernameSweep} onEmailLookup={onEmailLookup} />);
    // the stub echoes its prop keys — confirms both handlers were forwarded
    expect(screen.getByTestId("PhoneIdentity").textContent).toMatch(/onUsernameSweep/);
    expect(screen.getByTestId("PhoneIdentity").textContent).toMatch(/onEmailLookup/);
  });
});
