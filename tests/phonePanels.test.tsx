// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import NumberAnatomyPanel from "@/components/phone/NumberAnatomyPanel";
import SimIntelPanel from "@/components/phone/SimIntelPanel";
import PhoneIdentityPanel from "@/components/phone/PhoneIdentityPanel";
import type { LookupResponse, AggregatedResult, FullContactData, SourceResult } from "@/lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// ── shared fixtures ──────────────────────────────────────────────────────────
const agg = (over: Partial<AggregatedResult> = {}): AggregatedResult => ({
  carrier: null, lineType: null, typeDescription: "", country: "US", countryName: "United States",
  region: null, timezone: null, utcOffsets: null, isValid: true, fraudScore: null, isVoip: null,
  isMobile: null, isFixedLine: null, isAmbiguousType: false, isTollFree: null, isPremiumRate: null,
  isDisposable: null, isRisky: null, recentAbuse: null, carrierPrefix: null,
  formatE164: "+14155552671", formatInternational: "+1 415-555-2671", formatNational: "(415) 555-2671",
  formatRfc3966: "tel:+1-415-555-2671", prepaid: null, active: null, activeStatus: null,
  userActivity: null, mobileCountryCode: null, mobileNetworkCode: null, callerName: null,
  callerType: null, associatedEmails: null, city: null, numberLength: 10,
  ...over,
}) as AggregatedResult;

const analysis = (over: Record<string, unknown> = {}) => ({
  countryCallingCode: "+1", countryName: "United States", areaCode: "415", subscriberNumber: "5552671",
  isValid: true, isPossible: true, isValidForRegion: true, numberLength: 10, expectedLengths: [10],
  carrierPrefix: null, isTollFree: false, isSharedCost: false, isPersonalNumber: false, isPager: false,
  ...over,
});

const okFc = (data: Partial<FullContactData>): SourceResult<FullContactData> =>
  ({ ok: true, data: {
    fullName: null, age: null, gender: null, location: null, title: null, organization: null,
    bio: null, avatar: null, profiles: [], otherEmails: [], phones: [], employment: [], ...data,
  } });

const data = (aggOver: Partial<AggregatedResult> = {}, anaOver: Record<string, unknown> = {}, fc?: SourceResult<FullContactData>): LookupResponse =>
  ({
    input: { e164: "+14155552671", countryCallingCode: "1" },
    aggregated: agg(aggOver), analysis: analysis(anaOver),
    sources: { fullContact: fc ?? { ok: false, error: "NOT_CONFIGURED" } },
  }) as unknown as LookupResponse;

// ── NumberAnatomyPanel ───────────────────────────────────────────────────────
describe("<NumberAnatomyPanel>", () => {
  it("classifies each primary type from the aggregated/analysis flags", () => {
    const cases: [Partial<AggregatedResult>, Record<string, unknown>, string][] = [
      [{ isVoip: true }, {}, "VOIP / INTERNET"],
      [{ isPremiumRate: true }, {}, "PREMIUM RATE"],
      [{}, { isTollFree: true }, "TOLL-FREE"],
      [{}, { isSharedCost: true }, "SHARED COST"],
      [{}, { isPersonalNumber: true }, "PERSONAL NUMBER"],
      [{}, { isPager: true }, "PAGER"],
      [{ isMobile: true }, {}, "MOBILE"],
      [{ isFixedLine: true }, {}, "FIXED LINE"],
      [{ isAmbiguousType: true }, {}, "MOBILE OR FIXED"],
      [{ typeDescription: "Special" }, {}, "Special"],
    ];
    for (const [a, an, label] of cases) {
      cleanup();
      render(<NumberAnatomyPanel data={data(a, an)} />);
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("falls back to UNKNOWN when nothing resolves the type", () => {
    render(<NumberAnatomyPanel data={data({ typeDescription: "" })} />);
    expect(screen.getByText("UNKNOWN")).toBeTruthy();
  });

  it("shows the API line-type chip only when it differs from the derived label", () => {
    const { unmount } = render(<NumberAnatomyPanel data={data({ isMobile: true, lineType: "landline" })} />);
    expect(screen.getByText("API: landline")).toBeTruthy();
    unmount();
    // lineType === derived label (case-insensitive) → no chip
    render(<NumberAnatomyPanel data={data({ isMobile: true, lineType: "mobile" })} />);
    expect(screen.queryByText(/API:/)).toBeNull();
  });

  it("renders VALID vs INVALID from the aggregated validity flag", () => {
    const { unmount } = render(<NumberAnatomyPanel data={data({ isValid: true })} />);
    expect(screen.getByText("VALID")).toBeTruthy();
    unmount();
    render(<NumberAnatomyPanel data={data({ isValid: false })} />);
    expect(screen.getByText("INVALID")).toBeTruthy();
  });

  it("omits the area-code segment when there is no NPA, and shows the carrier prefix when present", () => {
    const { unmount } = render(<NumberAnatomyPanel data={data({}, { areaCode: null, carrierPrefix: "555" })} />);
    expect(screen.getByText(/Central office \(NXX\)/)).toBeTruthy();
    expect(screen.getByText("555")).toBeTruthy();
    expect(screen.getByText("Country Code")).toBeTruthy();
    expect(screen.queryByText("Area Code")).toBeNull();
    unmount();
    render(<NumberAnatomyPanel data={data({}, { areaCode: "415" })} />);
    expect(screen.getByText("Area Code")).toBeTruthy();
  });

  it("renders the expected-length hint only when lengths are known", () => {
    const { unmount } = render(<NumberAnatomyPanel data={data({}, { numberLength: 10, expectedLengths: [10] })} />);
    expect(screen.getByText(/expected 10/)).toBeTruthy();
    unmount();
    render(<NumberAnatomyPanel data={data({}, { expectedLengths: [] })} />);
    expect(screen.queryByText(/expected/)).toBeNull();
  });

  it("pads the length bar with dim cells for a short subscriber number", () => {
    // numberLength 7 < the 10-cell minimum → 3 trailing cells render dim
    const { container } = render(<NumberAnatomyPanel data={data({}, { numberLength: 7, subscriberNumber: "5552671" })} />);
    const cells = Array.from(container.querySelectorAll("div.h-1\\.5"));
    const dim = cells.filter((c) => c.className.includes("bg-[#00ff41]/10"));
    const filled = cells.filter((c) => !c.className.includes("bg-[#00ff41]/10"));
    expect(cells.length).toBe(10); // max(7, 10)
    expect(filled.length).toBe(7);
    expect(dim.length).toBe(3);
  });

  it("renders the three libphonenumber checks with TRUE/FALSE states", () => {
    render(<NumberAnatomyPanel data={data({}, { isValid: true, isPossible: false, isValidForRegion: true })} />);
    expect(screen.getByText(/isValid\(\) = TRUE/)).toBeTruthy();
    expect(screen.getByText(/isPossible\(\) = FALSE/)).toBeTruthy();
  });

  it("copies a format value and flips the copy icon back after the timeout", () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    try {
      render(<NumberAnatomyPanel data={data()} />);
      const copyButtons = screen.getAllByTitle("Copy");
      act(() => { fireEvent.click(copyButtons[0]!); });
      expect(writeText).toHaveBeenCalledWith("+14155552671");
      act(() => { vi.advanceTimersByTime(1300); }); // icon reverts
    } finally { vi.runOnlyPendingTimers(); vi.useRealTimers(); }
  });
});

// ── SimIntelPanel ────────────────────────────────────────────────────────────
describe("<SimIntelPanel>", () => {
  it("prompts for keys when there is no SIM data", () => {
    render(<SimIntelPanel aggregated={agg()} />);
    expect(screen.getByText(/add ipqs or twilio api keys/i)).toBeTruthy();
  });

  it("renders every populated row, the PLMN combination and the MCC/MNC note", () => {
    render(<SimIntelPanel aggregated={agg({
      carrier: "Verizon", callerName: "Ada", callerType: "business", prepaid: false, active: true,
      activeStatus: "Active", userActivity: "high", mobileCountryCode: "310", mobileNetworkCode: "012",
      city: "SF", associatedEmails: ["a@x.com", "b@y.com"],
    })} />);
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("Business")).toBeTruthy();      // capitalised caller type
    expect(screen.getByText("Verizon")).toBeTruthy();
    expect(screen.getByText("310-012")).toBeTruthy();       // PLMN
    expect(screen.getAllByText("YES").length).toBeGreaterThan(0); // active badge
    expect(screen.getByText("a@x.com")).toBeTruthy();
    expect(screen.getByText(/MCC = Mobile Country Code/)).toBeTruthy();
  });

  it("colours activity and status by keyword, and shows a prepaid badge", () => {
    render(<SimIntelPanel aggregated={agg({ activeStatus: "Dormant", userActivity: "low", prepaid: true })} />);
    expect(screen.getByText("Dormant")).toBeTruthy();
    expect(screen.getByText("low")).toBeTruthy();
    // prepaid true → its own badge row present
    expect(screen.getByText("Prepaid SIM")).toBeTruthy();
  });

  it("handles a neutral activity string and a not-active line", () => {
    render(<SimIntelPanel aggregated={agg({ active: false, userActivity: "medium" })} />);
    expect(screen.getByText("NO")).toBeTruthy();       // inactive badge
    expect(screen.getByText("medium")).toBeTruthy();
  });

  it("shows only MCC without a PLMN row when the network code is absent", () => {
    render(<SimIntelPanel aggregated={agg({ mobileCountryCode: "310" })} />);
    expect(screen.getByText("MCC (Country)")).toBeTruthy();
    expect(screen.queryByText("PLMN Code")).toBeNull();
    expect(screen.getByText(/MCC = Mobile Country Code/)).toBeTruthy(); // note shows for MCC alone
  });
});

// ── PhoneIdentityPanel ───────────────────────────────────────────────────────
describe("<PhoneIdentityPanel>", () => {
  it("shows the action-center empty state and the FullContact hint when nothing resolved", () => {
    render(<PhoneIdentityPanel data={data()} />);
    expect(screen.getByText(/no identity resolved/i)).toBeTruthy();
    expect(screen.getByText(/FULLCONTACT_API_KEY/)).toBeTruthy();
  });

  it("hides the FullContact hint in the empty state when the key is configured", () => {
    render(<PhoneIdentityPanel data={data({}, {}, { ok: false, error: "NOT_FOUND" } as never)} />);
    expect(screen.getByText(/no identity resolved/i)).toBeTruthy();
    expect(screen.queryByText(/FULLCONTACT_API_KEY/)).toBeNull();
  });

  it("renders a full FullContact identity with profiles, emails, phones and employment", () => {
    const onUsernameSweep = vi.fn();
    const onEmailLookup = vi.fn();
    render(<PhoneIdentityPanel
      onUsernameSweep={onUsernameSweep}
      onEmailLookup={onEmailLookup}
      data={data({ associatedEmails: ["ipqs@x.com"] }, {}, okFc({
        fullName: "Ada Lovelace", title: "Analyst", organization: "Acme", location: "London",
        bio: "Pioneer", avatar: "https://img/x.png", age: 36, gender: "f",
        profiles: [{ platform: "github", username: "ada", url: "https://github.com/ada" }],
        otherEmails: ["ada@x.com"], phones: ["+15551234"],
        employment: [{ current: true, name: "Acme", title: "Analyst" }, { current: false, name: "Old", title: "" }],
      }))}
    />);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Analyst @ Acme")).toBeTruthy();
    expect(screen.getByText(/London/)).toBeTruthy();
    expect(screen.getByText(/Pioneer/)).toBeTruthy();
    expect(screen.getByText("AGE ~36")).toBeTruthy();
    expect(screen.getByText("FULLCONTACT ✓")).toBeTruthy();

    // username sweep pivot
    fireEvent.click(screen.getByRole("button", { name: /sweep ada as username/i }));
    expect(onUsernameSweep).toHaveBeenCalledWith("ada");
    // both FC + IPQS emails merged, each with a lookup pivot
    fireEvent.click(screen.getByRole("button", { name: /look up ada@x\.com/i }));
    expect(onEmailLookup).toHaveBeenCalledWith("ada@x.com");
    expect(screen.getByText("ipqs@x.com")).toBeTruthy();
    expect(screen.getByText("+15551234")).toBeTruthy();
    expect(screen.getByText(/Acme — Analyst/)).toBeTruthy();
    expect(screen.getByText("Old")).toBeTruthy();
  });

  it("falls back to CNAM identity when FullContact is absent", () => {
    render(<PhoneIdentityPanel data={data({ callerName: "JOHN DOE", callerType: "residential", city: "Reno" })} />);
    expect(screen.getByText("JOHN DOE")).toBeTruthy();
    expect(screen.getByText("CNAM ✓")).toBeTruthy();
    expect(screen.getByText("RESIDENTIAL")).toBeTruthy();
    expect(screen.getByText(/Reno/)).toBeTruthy();
  });

  it("hides the avatar on a load error, pluralises the profile count, and omits the sweep pivot for implausible/absent handles", () => {
    render(<PhoneIdentityPanel
      onUsernameSweep={vi.fn()}
      data={data({}, {}, okFc({
        fullName: "X", avatar: "https://img/broken.png",
        profiles: [
          { platform: "site", username: "a b!!", url: "https://site/x" }, // not a plausible handle
          { platform: "bare", username: "", url: "https://bare/x" },       // no username at all
        ],
      }))}
    />);
    const img = screen.getByAltText("Profile") as HTMLImageElement;
    fireEvent.error(img);
    expect(img.style.display).toBe("none");
    expect(screen.getByText(/2 linked accounts/)).toBeTruthy(); // plural
    expect(screen.getByText("bare")).toBeTruthy();               // platform-only label, no ": handle"
    expect(screen.queryByRole("button", { name: /sweep/i })).toBeNull();
  });

  it("renders a single realTitle or realOrg when only one is present", () => {
    const { unmount } = render(<PhoneIdentityPanel data={data({}, {}, okFc({ fullName: "X", title: "CEO" }))} />);
    expect(screen.getByText("CEO")).toBeTruthy();
    unmount();
    render(<PhoneIdentityPanel data={data({}, {}, okFc({ fullName: "X", organization: "OrgOnly" }))} />);
    expect(screen.getByText("OrgOnly")).toBeTruthy();
  });

  it("omits email pivot buttons when no handler is supplied", () => {
    render(<PhoneIdentityPanel data={data({}, {}, okFc({ fullName: "X", otherEmails: ["a@x.com"] }))} />);
    expect(screen.getByText("a@x.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /look up/i })).toBeNull();
  });
});
