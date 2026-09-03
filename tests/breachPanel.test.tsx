// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import BreachPanel from "@/components/breach/BreachPanel";
import type { XposedOrNotData, XposedOrNotBreach, BreachDirectoryData, BreachDirectoryEntry } from "@/lib/types";

const SHA1 = "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8"; // sha1("password")
const MD5  = "5f4dcc3b5aa765d61d8327deb882cf99";           // md5("password")
const BCRYPT = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const entry = (over: Partial<BreachDirectoryEntry> = {}): BreachDirectoryEntry =>
  ({ password: "pa****rd", sha1: SHA1, hash: MD5, sources: ["LinkedIn"], ...over });

const bd = (over: Partial<BreachDirectoryData> = {}): BreachDirectoryData =>
  ({ found: 1, fields: ["password"], sources: ["LinkedIn"], results: [entry()], ...over });

const breach = (over: Partial<XposedOrNotBreach> = {}): XposedOrNotBreach =>
  ({ breach: "LinkedIn", xposedData: ["Passwords", "Email addresses"], xposedDate: "2012-06-05",
     xposedRecords: 164_000_000, domain: "linkedin.com", passwordRisk: "EasyToCrack", verified: true, ...over });

const xon = (over: Partial<XposedOrNotData> = {}): XposedOrNotData =>
  ({ breachCount: 1, breaches: [breach()], xposedDataTypes: ["Passwords", "Email addresses"],
     yearwiseDetails: { "2012": 1 }, ...over });

// ── Phone mode (no xon → BdOnlyPanel) ────────────────────────────────────────
describe("<BreachPanel> phone mode", () => {
  it("shows the CLEAN state when BreachDirectory found nothing", () => {
    render(<BreachPanel breachDirectory={{ ok: true, data: bd({ found: 0, results: [] }) }} subjectLabel="this phone" e164="+14155552671" />);
    expect(screen.getByText(/CLEAN \(BreachDirectory\)/)).toBeTruthy();
    expect(screen.getByText(/FREE BREACH LOOKUPS/)).toBeTruthy();
    expect(screen.getByText("Dehashed")).toBeTruthy();
  });

  it("renders credential hashes with crack buttons when records are found", () => {
    render(<BreachPanel breachDirectory={{ ok: true, data: bd({ found: 3, sources: ["LinkedIn", "Adobe"] }) }} subjectLabel="this phone" e164="+14155552671" />);
    expect(screen.getByText(/3 RECORDS/)).toBeTruthy();
    expect(screen.getByText(/appears in 2 breach datasets/)).toBeTruthy();
    expect(screen.getByText("SHA-1 HASH")).toBeTruthy();
    expect(screen.getByText("MD5 HASH")).toBeTruthy();
    expect(screen.getByText("PARTIAL PASSWORD")).toBeTruthy();
    expect(screen.getAllByText(/CRACK →/).length).toBeGreaterThan(0);
  });

  it("uses singular RECORD wording and 'one or more' when sources are empty", () => {
    const { container } = render(<BreachPanel breachDirectory={{ ok: true, data: bd({ found: 1, sources: [] }) }} subjectLabel="this phone" e164="+1" />);
    expect(screen.getByText(/1 RECORD$/)).toBeTruthy();
    // the sentence is split across an icon + spans, so match on the flattened text
    expect(container.textContent).toContain("appears in one or more breach dataset");
  });

  it("caps the credential list at 10 and notes the remainder", () => {
    render(<BreachPanel breachDirectory={{ ok: true, data: bd({ found: 12, results: Array.from({ length: 12 }, () => entry()) }) }} subjectLabel="this phone" e164="+1" />);
    expect(screen.getByText(/\+ 2 more records \(showing first 10\)/)).toBeTruthy();
  });

  it("shows the not-configured guidance and omits free lookups without an e164", () => {
    render(<BreachPanel breachDirectory={{ ok: false, error: "NOT_CONFIGURED" }} subjectLabel="this phone" />);
    expect(screen.getByText(/No BreachDirectory key configured/)).toBeTruthy();
    expect(screen.getByText(/Want in-app credential hashes/)).toBeTruthy();
    expect(screen.queryByText(/FREE BREACH LOOKUPS/)).toBeNull(); // no e164 → no buttons
  });

  it("surfaces a configured BreachDirectory error, and 'unknown' when the error is absent", () => {
    const { unmount } = render(<BreachPanel breachDirectory={{ ok: false, error: "429 rate limited" }} subjectLabel="this phone" e164="+1" />);
    expect(screen.getByText(/BreachDirectory error: 429 rate limited/)).toBeTruthy();
    unmount();
    render(<BreachPanel breachDirectory={{ ok: false }} subjectLabel="this phone" e164="+1" />);
    expect(screen.getByText(/BreachDirectory error: unknown/)).toBeTruthy();
  });

  it("drops a credential card's SHA-1/partial fields when only the MD5 hash is present", () => {
    render(<BreachPanel breachDirectory={{ ok: true, data: bd({ found: 1, results: [entry({ sha1: "", password: "", hash: MD5 })] }) }} subjectLabel="this phone" e164="+1" />);
    expect(screen.getByText("MD5 HASH")).toBeTruthy();
    expect(screen.queryByText("SHA-1 HASH")).toBeNull();
    expect(screen.queryByText("PARTIAL PASSWORD")).toBeNull();
  });

  it("copies a hash and opens a cracking tool in one click", () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      render(<BreachPanel breachDirectory={{ ok: true, data: bd() }} subjectLabel="this phone" e164="+1" />);
      const crackBtn = screen.getAllByText(/CRACK →/)[0]!.closest("button")!;
      act(() => { fireEvent.click(crackBtn); });
      expect(writeText).toHaveBeenCalledWith(SHA1);
      expect(open).toHaveBeenCalled();
      expect(screen.getByText(/COPIED \+ OPENED/)).toBeTruthy();
      act(() => { vi.advanceTimersByTime(2100); });
    } finally { vi.runOnlyPendingTimers(); vi.useRealTimers(); }
  });

  it("copies a hash from the COPY button", () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    try {
      render(<BreachPanel breachDirectory={{ ok: true, data: bd() }} subjectLabel="this phone" e164="+1" />);
      act(() => { fireEvent.click(screen.getAllByText("COPY")[0]!.closest("button")!); });
      expect(writeText).toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1600); });
    } finally { vi.runOnlyPendingTimers(); vi.useRealTimers(); }
  });
});

// ── Email mode (xon present → main panel) ────────────────────────────────────
describe("<BreachPanel> email mode", () => {
  it("renders the XposedOrNot error, rate-limit and unknown-error states", () => {
    const { unmount } = render(<BreachPanel xon={{ ok: false, error: "RATE_LIMITED" }} breachDirectory={{ ok: false, error: "NOT_CONFIGURED" }} />);
    expect(screen.getByText(/Rate limited/)).toBeTruthy();
    unmount();
    const { unmount: u2 } = render(<BreachPanel xon={{ ok: false, error: "boom" }} breachDirectory={{ ok: false, error: "NOT_CONFIGURED" }} />);
    expect(screen.getByText(/Could not reach XposedOrNot: boom/)).toBeTruthy();
    u2();
    render(<BreachPanel xon={{ ok: false }} breachDirectory={{ ok: false, error: "NOT_CONFIGURED" }} />);
    expect(screen.getByText(/Could not reach XposedOrNot: unknown error/)).toBeTruthy();
  });

  it("formats breach record counts across K / M / B and hides tiny/zero counts", () => {
    render(<BreachPanel
      xon={{ ok: true, data: xon({
        breachCount: 4,
        breaches: [
          breach({ breach: "Big",   xposedRecords: 3_200_000_000, passwordRisk: "StrongHash" }), // 3.2B
          breach({ breach: "Mid",   xposedRecords: 164_000_000,   passwordRisk: "StrongHash" }), // 164.0M
          breach({ breach: "Small", xposedRecords: 4_500,         passwordRisk: "StrongHash" }), // 5K
          breach({ breach: "Tiny",  xposedRecords: 12,            passwordRisk: "StrongHash" }), // "12"
        ],
      }) }}
      breachDirectory={{ ok: false, error: "NOT_CONFIGURED" }}
    />);
    expect(screen.getByText(/3\.2B records/)).toBeTruthy();
    expect(screen.getByText(/164\.0M records/)).toBeTruthy();
    expect(screen.getByText(/5K records/)).toBeTruthy();
    expect(screen.getByText(/12 records/)).toBeTruthy();
  });

  it("uses the Unknown fallback for an unrecognised password-risk value", () => {
    render(<BreachPanel
      xon={{ ok: true, data: xon({ breaches: [breach({ passwordRisk: "SomethingElse", xposedData: ["Passwords"] })] }) }}
      breachDirectory={{ ok: false, error: "NOT_CONFIGURED" }}
    />);
    // RiskBadge + BreachRow both fall back to the "UNKNOWN" meta
    expect(screen.getByText("UNKNOWN")).toBeTruthy();
  });

  it("caps the email-mode credential list at 10 with a remainder note", () => {
    render(<BreachPanel
      xon={{ ok: true, data: xon() }}
      breachDirectory={{ ok: true, data: bd({ found: 11, results: Array.from({ length: 11 }, () => entry()) }) }}
    />);
    expect(screen.getByText(/\+ 1 more records \(showing first 10\)/)).toBeTruthy();
  });

  it("renders the CLEAN email state with the footer note", () => {
    render(<BreachPanel xon={{ ok: true, data: xon({ breachCount: 0, breaches: [], xposedDataTypes: [] }) }} breachDirectory={{ ok: false, error: "NOT_CONFIGURED" }} />);
    expect(screen.getByText("CLEAN")).toBeTruthy();
    expect(screen.getByText(/no exposures across 1000\+ breach databases/)).toBeTruthy();
    expect(screen.getByText(/Use the OSINT matrix below/)).toBeTruthy();
  });

  it("renders a plaintext-critical breach with warnings, data types and the breach list", () => {
    render(<BreachPanel
      xon={{ ok: true, data: xon({
        breachCount: 2,
        breaches: [breach({ passwordRisk: "ClearText" }), breach({ breach: "Adobe", xposedDate: "2013-10-04", passwordRisk: "StrongHash", xposedData: ["Usernames"], domain: "", verified: false, xposedRecords: 0 })],
      }) }}
      breachDirectory={{ ok: false, error: "NOT_CONFIGURED" }}
    />);
    expect(screen.getByText(/2 BREACHES/)).toBeTruthy();
    expect(screen.getByText(/1 with crackable passwords/)).toBeTruthy();
    expect(screen.getByText(/CRITICAL: Plaintext passwords exposed/)).toBeTruthy();
    expect(screen.getByText(/What this means/)).toBeTruthy();
    // Adobe breach: no domain link, no VERIFIED, no records line
    expect(screen.getByText("Adobe")).toBeTruthy();
    // BreachDirectory not configured + crackable → manual crack tools shown
    expect(screen.getByText(/GET ACTUAL LEAKED PASSWORDS/)).toBeTruthy();
    expect(screen.getByText("CrackStation")).toBeTruthy();
  });

  it("shows the HIGH RISK (easy-crack, no plaintext) warning and singular BREACH wording", () => {
    render(<BreachPanel xon={{ ok: true, data: xon({ breachCount: 1, breaches: [breach({ passwordRisk: "EasyToCrack" })] }) }} breachDirectory={{ ok: false, error: "NOT_CONFIGURED" }} />);
    expect(screen.getByText(/1 BREACH$/)).toBeTruthy();
    expect(screen.getByText(/HIGH RISK: MD5\/SHA-1 hashes exposed/)).toBeTruthy();
  });

  it("renders BreachDirectory credential hashes alongside XposedOrNot data", () => {
    render(<BreachPanel
      xon={{ ok: true, data: xon() }}
      breachDirectory={{ ok: true, data: bd({ found: 2 }) }}
    />);
    expect(screen.getByText(/ACTUAL CREDENTIAL HASHES/)).toBeTruthy();
    expect(screen.getByText(/2 records found/)).toBeTruthy();
    expect(screen.getByText("SHA-1 HASH")).toBeTruthy();
  });

  it("renders the BreachDirectory 'no records' state", () => {
    render(<BreachPanel xon={{ ok: true, data: xon() }} breachDirectory={{ ok: true, data: bd({ found: 0, results: [] }) }} />);
    expect(screen.getByText(/No credential records found in BreachDirectory/)).toBeTruthy();
  });

  it("omits the crack buttons for an infeasible (bcrypt) hash and for the partial password", () => {
    render(<BreachPanel
      xon={{ ok: true, data: xon() }}
      breachDirectory={{ ok: true, data: bd({ found: 1, results: [entry({ sha1: BCRYPT, hash: "", password: "pa****rd" })] }) }}
    />);
    expect(screen.getByText("bcrypt")).toBeTruthy();
    // bcrypt is infeasible → no CRACK buttons at all
    expect(screen.queryByText(/CRACK →/)).toBeNull();
  });

  it("hides the setup guide when BreachDirectory is configured but returned an error", () => {
    render(<BreachPanel xon={{ ok: true, data: xon() }} breachDirectory={{ ok: false, error: "boom" }} />);
    // configured (error !== NOT_CONFIGURED) and no bdData → the whole credential block is null
    expect(screen.queryByText(/GET ACTUAL LEAKED PASSWORDS/)).toBeNull();
    expect(screen.queryByText(/No credential records found/)).toBeNull();
  });

  it("uses the default badge colour for an unrecognised data type", () => {
    render(<BreachPanel
      xon={{ ok: true, data: xon({ breaches: [breach({ xposedData: ["Weird Type"], passwordRisk: "Unknown", verified: false })], xposedDataTypes: ["Weird Type"] }) }}
      breachDirectory={{ ok: false, error: "NOT_CONFIGURED" }}
    />);
    expect(screen.getAllByText("WEIRD TYPE").length).toBeGreaterThan(0); // getDataTypeColor fallback
  });
});
