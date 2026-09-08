// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { installMemoryLocalStorage, installResizeObserver } from "./testUtils";
import type { EmailLookupResponse, EmailAnalysis, EmailRepData, HunterData, AbstractEmailData,
  GravatarProfile, XposedOrNotData, FullContactData, SourceResult } from "@/lib/types";

// The two heavy children (BreachPanel, EmailOsintPivots) have their own suites;
// stub them so this test targets EmailResultsDashboard's own logic.
const { mockPanel } = vi.hoisted(() => ({
  mockPanel: (name: string) => async () => {
    const React = await import("react");
    return { default: () => React.createElement("div", { "data-testid": name }, name) };
  },
}));
vi.mock("@/components/breach/BreachPanel", mockPanel("BreachPanel"));
vi.mock("@/components/email/EmailOsintPivots", mockPanel("EmailOsintPivots"));

import EmailResultsDashboard from "@/components/email/EmailResultsDashboard";

beforeAll(() => { installMemoryLocalStorage(); installResizeObserver(); });
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const off = (): SourceResult<never> => ({ ok: false, error: "NOT_CONFIGURED" });
const okS = <T,>(d: T): SourceResult<T> => ({ ok: true, data: d });

const analysis = (over: Record<string, unknown> = {}): EmailAnalysis => ({
  email: "ada.lovelace@gmail.com", username: "ada.lovelace", domain: "gmail.com", tld: "com",
  isValidFormat: true, providerType: "free", providerName: "Gmail", isDisposable: false,
  isWebmail: true, isPrivacyFocused: false, isRoleAddress: false, guessedName: "Ada Lovelace", ...over,
} as EmailAnalysis);

const gravatar = (over: Partial<GravatarProfile> = {}): GravatarProfile => ({
  found: false, displayName: null, preferredUsername: null, aboutMe: null, currentLocation: null,
  profileUrl: null, thumbnailUrl: null, accounts: [], verifiedAccounts: [], ...over,
});

const rep = (over: Partial<EmailRepData> = {}): EmailRepData => ({
  email: "x", reputation: "high", suspicious: false, references: 12, blacklisted: false,
  maliciousActivity: false, credentialsLeaked: false, dataBreach: false, firstSeen: "2015-01-01",
  lastSeen: "2025-01-01", domainExists: true, newDomain: false, freeProvider: true, disposable: false,
  deliverable: true, validMx: true, primaryMx: "gmail-smtp-in.l.google.com", spam: false,
  spoofable: false, spfStrict: true, dmarc: true, profiles: ["twitter", "github"], ...over,
});

const hunter = (over: Partial<HunterData> = {}): HunterData => ({
  result: "deliverable", score: 95, regexp: true, gibberish: false, disposable: false, webmail: true,
  mxRecords: true, smtpServer: true, smtpCheck: true, acceptAll: false, block: false, ...over,
});

const abstract = (over: Partial<AbstractEmailData> = {}): AbstractEmailData => ({
  email: "x", autocorrect: "", deliverability: "DELIVERABLE", qualityScore: 0.95, isValidFormat: true,
  isFreeEmail: true, isDisposableEmail: false, isRoleEmail: false, isCatchallEmail: false,
  isMxFound: true, isSmtpValid: true, ...over,
});

const fc = (over: Partial<FullContactData> = {}): FullContactData => ({
  fullName: "Ada Lovelace", age: 36, gender: "female", location: "London", title: "Analyst",
  organization: "Acme", bio: "Pioneer", avatar: "https://img/ada.png",
  profiles: [{ platform: "github", username: "ada", url: "https://github.com/ada" }],
  otherEmails: ["ada@work.com"], phones: ["+15551234"],
  employment: [{ current: true, name: "Acme", title: "Analyst" }, { current: false, name: "Old", title: "" }], ...over,
});

const xonD = (over: Partial<XposedOrNotData> = {}): XposedOrNotData =>
  ({ breachCount: 1, breaches: [{ breach: "LinkedIn", xposedData: ["Passwords"], xposedDate: "2024-06-05",
     xposedRecords: 164_000_000, domain: "linkedin.com", passwordRisk: "ClearText", verified: true }],
     xposedDataTypes: ["Passwords"], yearwiseDetails: {}, ...over });

const data = (over: Partial<EmailLookupResponse> = {}): EmailLookupResponse => ({
  email: "ada.lovelace@gmail.com", analysis: analysis() as never, gravatar: gravatar(),
  emailrep: off(), hunter: off(), abstract: off(), xon: off(), breachDirectory: off(), fullContact: off(),
  hudsonRock: off(), leakCheck: off(), comb: off(), hibp: off(),
  ...over,
});

describe("<EmailResultsDashboard> header + identity", () => {
  it("renders the minimal offline result with the inferred name and provider badge", () => {
    render(<EmailResultsDashboard data={data()} />);
    expect(screen.getByText("ada.lovelace@gmail.com")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("INFERRED")).toBeTruthy();
    expect(screen.getAllByText("FREE").length).toBeGreaterThan(0); // provider badge + glance tile
    expect(screen.getByText("CLEAN")).toBeTruthy();                // threat 0
    expect(screen.getByText(/No Gravatar profile/)).toBeTruthy();
    expect(screen.getByTestId("BreachPanel")).toBeTruthy();
  });

  it("prefers FullContact identity and shows the enrichment panel", () => {
    render(<EmailResultsDashboard data={data({ fullContact: okS(fc()) })} />);
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(screen.getByText("✓ FULLCONTACT CONFIRMED")).toBeTruthy();
    expect(screen.getByText(/FULLCONTACT ENRICHMENT/)).toBeTruthy();
    expect(screen.getByText("AGE ~36")).toBeTruthy();
    expect(screen.getByText(/Analyst @ Acme/)).toBeTruthy();
    expect(screen.getByText("ada@work.com")).toBeTruthy();
    expect(screen.getByText("+15551234")).toBeTruthy();
    expect(screen.getByText(/Acme: Analyst/)).toBeTruthy();
    expect(screen.getByText("Old")).toBeTruthy();
  });

  it("prefers a Gravatar name/location/avatar when FullContact is absent", () => {
    render(<EmailResultsDashboard data={data({
      gravatar: gravatar({ found: true, displayName: "Ada L", currentLocation: "Reno", aboutMe: "hi",
        profileUrl: "https://gravatar.com/ada", thumbnailUrl: "https://img/g.png", preferredUsername: "adal",
        accounts: [{ shortname: "github", username: "ada", url: "https://github.com/ada" }] }),
    })} />);
    expect(screen.getAllByText("Ada L").length).toBeGreaterThan(0); // header + Gravatar panel
    expect(screen.getByText("✓ GRAVATAR CONFIRMED")).toBeTruthy();
    expect(screen.getAllByText(/Reno/).length).toBeGreaterThan(0);
    expect(screen.getByText("GRAVATAR ✓")).toBeTruthy();
    expect(screen.getByText(/GRAVATAR$/)).toBeTruthy(); // profile link button
    expect(screen.getByText(/github: ada/)).toBeTruthy();
  });

  it("offers the username-sweep pivot for a personal address but not a role inbox", () => {
    const onUsernameSweep = vi.fn();
    const { unmount } = render(<EmailResultsDashboard data={data()} onUsernameSweep={onUsernameSweep} />);
    fireEvent.click(screen.getByRole("button", { name: /sweep .* as username/i }));
    expect(onUsernameSweep).toHaveBeenCalledWith("ada.lovelace");
    unmount();

    render(<EmailResultsDashboard data={data({ analysis: analysis({ isRoleAddress: true, guessedName: null }) })} onUsernameSweep={onUsernameSweep} />);
    expect(screen.queryByRole("button", { name: /as username/i })).toBeNull();
    expect(screen.getByText("ROLE ADDRESS")).toBeTruthy();
  });

  it("hides the avatar image on load error", () => {
    const { container } = render(<EmailResultsDashboard data={data({ gravatar: gravatar({ found: true, thumbnailUrl: "https://img/g.png" }) })} />);
    const img = container.querySelector("img")!;
    fireEvent.error(img);
    expect(img.style.display).toBe("none");
  });

  it("shows a CACHED badge, an org-only headline, and enrichment edge cases", () => {
    render(<EmailResultsDashboard data={data({
      cachedAt: Date.now(),
      fullContact: okS(fc({
        title: null, organization: "Acme Corp",        // headline falls back to organization
        age: null, gender: "female",                    // age null → gender side of the OR
        profiles: [{ platform: "site", username: "", url: "https://site/x" }], // no-username profile label
        otherEmails: [], phones: ["+15550000"],          // phones only (otherEmails empty)
        employment: [{ current: false, name: "OldCo", title: null }], // emp title null
      })),
    })} />);
    expect(screen.getByText("CACHED")).toBeTruthy();
    expect(screen.getByText(/^Acme Corp$/)).toBeTruthy();        // org-only headline (title null)
    expect(screen.getByText("FEMALE")).toBeTruthy();             // gender badge via the OR's right side
    expect(screen.getByText("site")).toBeTruthy();               // profile label without ": handle"
    expect(screen.getByText("+15550000")).toBeTruthy();
    expect(screen.getByText("OldCo")).toBeTruthy();
  });

  it("shows the panel 'No data' fallback when Abstract/Hunter fail without a message", () => {
    render(<EmailResultsDashboard data={data({ abstract: { ok: false }, hunter: { ok: false } })} />);
    // panels fall back to "No data" when the error string is absent (not NOT_CONFIGURED)
    expect(screen.getAllByText("No data").length).toBeGreaterThan(0);
  });
});

describe("<EmailResultsDashboard> threat score", () => {
  it("scores a plaintext, recently-breached, credential-leaked email as critical", () => {
    render(<EmailResultsDashboard data={data({
      xon: okS(xonD()), // plaintext + recent (2024) → +30 +10 + breachCount
      emailrep: okS(rep({ credentialsLeaked: true, maliciousActivity: true, suspicious: true, blacklisted: true, spam: true })),
    })} />);
    // blacklisted forces >=60; malicious +20 etc → CRITICAL band
    expect(screen.getByText(/CRITICAL/)).toBeTruthy();
    expect(screen.getByText("CREDS LEAKED")).toBeTruthy();
    expect(screen.getByText("SUSPICIOUS")).toBeTruthy();
    expect(screen.getByText(/ADDITIONAL RISK FLAGS/)).toBeTruthy();
    expect(screen.getByText(/Credentials confirmed in breach database/)).toBeTruthy();
    expect(screen.getByText(/Associated with phishing/)).toBeTruthy();
  });

  it("scores an easy-crack breach in the moderate/high band", () => {
    render(<EmailResultsDashboard data={data({
      xon: okS(xonD({ breachCount: 2, breaches: [
        { breach: "A", xposedData: ["Passwords"], xposedDate: "2013-01-01", xposedRecords: 1, domain: "a.com", passwordRisk: "EasyToCrack", verified: true },
      ] })),
    })} />);
    expect(screen.getByText(/MODERATE|HIGH RISK/)).toBeTruthy();
  });

  it("scores a data-breach-only email and shows the data-breach risk flag", () => {
    render(<EmailResultsDashboard data={data({
      emailrep: okS(rep({ dataBreach: true, reputation: "medium" })),
      xon: okS(xonD({ breachCount: 0, breaches: [], xposedDataTypes: [] })),
    })} />);
    expect(screen.getByText(/Appeared in one or more data breaches/)).toBeTruthy();
  });

  it("shows the union of breach sources, not XposedOrNot alone", () => {
    // XON knows 1 breach, LeakCheck knows 3 different ones. The old header
    // counted XON only (1); the unified view is the union (4).
    render(<EmailResultsDashboard data={data({
      xon: okS(xonD({ breachCount: 1, breaches: [
        { breach: "LinkedIn", xposedData: ["Passwords"], xposedDate: "2012-05-05",
          xposedRecords: 1, domain: "linkedin.com", passwordRisk: "ClearText", verified: true },
      ] })),
      leakCheck: okS({ found: 9, fields: ["email"], sources: [
        { name: "Canva.com", date: "2019-05" }, { name: "Dropbox.com", date: "2012-07" },
        { name: "MySpace.com", date: "2008-01" },
      ] }),
    })} />);
    expect(screen.getByText(/4 BREACHES/)).toBeTruthy();
    expect(screen.getByText(/across 2 sources: LeakCheck, XposedOrNot/)).toBeTruthy();
  });

  it("treats a disposable address as at least moderate risk", () => {
    render(<EmailResultsDashboard data={data({ analysis: analysis({ isDisposable: true, providerType: "disposable", providerName: "Mailinator" }) })} />);
    expect(screen.getAllByText("DISPOSABLE").length).toBeGreaterThan(0);
    expect(screen.getByText(/MODERATE/)).toBeTruthy();
  });

  it("adds password-only and hashed-breach points without plaintext/easy-crack", () => {
    render(<EmailResultsDashboard data={data({
      xon: okS(xonD({ breaches: [
        { breach: "H", xposedData: ["Passwords"], xposedDate: "2010-01-01", xposedRecords: 1, domain: "h.com", passwordRisk: "StrongHash", verified: false },
      ] })),
    })} />);
    expect(screen.getByText(/LOW RISK|MODERATE/)).toBeTruthy();
  });

  it("labels a small non-password breach as LOW RISK", () => {
    render(<EmailResultsDashboard data={data({
      xon: okS(xonD({ breachCount: 1, xposedDataTypes: ["Email addresses"], breaches: [
        { breach: "E", xposedData: ["Email addresses"], xposedDate: "2010-01-01", xposedRecords: 1, domain: "e.com", passwordRisk: "Unknown", verified: false },
      ] })),
    })} />);
    // +10 for the single breach, no password/recent bonus → score 10 → LOW RISK band
    expect(screen.getByText("LOW RISK")).toBeTruthy();
  });
});

describe("<EmailResultsDashboard> reputation / validation panels", () => {
  it("renders EmailRep, Abstract and Hunter data with registered platforms", () => {
    render(<EmailResultsDashboard data={data({
      emailrep: okS(rep()), abstract: okS(abstract({ autocorrect: "ada@gmail.com" })),
      hunter: okS(hunter({ result: "risky", score: 40, gibberish: true })),
    })} />);
    expect(screen.getByText("REGISTERED PLATFORMS")).toBeTruthy();
    expect(screen.getByText("twitter")).toBeTruthy();
    expect(screen.getByText(/Did You Mean/)).toBeTruthy();      // abstract autocorrect
    expect(screen.getByText("95%")).toBeTruthy();               // quality score
    expect(screen.getByText("RISKY")).toBeTruthy();             // hunter result
    expect(screen.getByText(/Gibberish/)).toBeTruthy();
  });

  it("shows the not-configured / rate-limited fallbacks for each source", () => {
    // Default data has emailrep NOT_CONFIGURED → the "add a key" hint, matching
    // how Abstract/Hunter present their unconfigured state.
    const { unmount: u0 } = render(<EmailResultsDashboard data={data()} />);
    expect(screen.getByText(/Add EMAILREP_API_KEY/)).toBeTruthy();
    u0();

    const { unmount } = render(<EmailResultsDashboard data={data({ emailrep: { ok: false, error: "RATE_LIMITED" } })} />);
    expect(screen.getByText(/Rate limited: try again/)).toBeTruthy();
    expect(screen.getByText(/Add ABSTRACT_API_KEY/)).toBeTruthy();
    expect(screen.getByText(/Add HUNTER_API_KEY/)).toBeTruthy();
    unmount();

    render(<EmailResultsDashboard data={data({ emailrep: { ok: false, error: "boom" }, abstract: { ok: false, error: "down" }, hunter: { ok: false, error: "nope" } })} />);
    expect(screen.getByText(/EmailRep\.io did not return data/)).toBeTruthy(); // ok=false, non-rate-limited
    expect(screen.getByText("down")).toBeTruthy();
    expect(screen.getByText("nope")).toBeTruthy();
  });

  it("colours medium reputation and undeliverable results", () => {
    render(<EmailResultsDashboard data={data({
      emailrep: okS(rep({ reputation: "medium", primaryMx: null, firstSeen: null, lastSeen: null, profiles: [] })),
      abstract: okS(abstract({ deliverability: "UNDELIVERABLE", qualityScore: 0.2, isSmtpValid: false })),
      hunter: okS(hunter({ result: "undeliverable", score: 10, smtpCheck: false, mxRecords: false, block: true })),
    })} />);
    expect(screen.getAllByText("MEDIUM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("UNDELIVERABLE").length).toBeGreaterThan(0); // abstract + hunter
    expect(screen.getByText("Not found")).toBeTruthy(); // hunter mxRecords false
  });

  it("renders the opposite polarity of every reputation/validation flag", () => {
    render(<EmailResultsDashboard data={data({
      analysis: analysis({ isPrivacyFocused: true, isWebmail: false, providerType: "privacy", providerName: "ProtonMail", guessedName: null }),
      emailrep: okS(rep({ reputation: "low", suspicious: true, credentialsLeaked: true, dataBreach: true,
        maliciousActivity: true, deliverable: false, spam: true })),
      abstract: okS(abstract({ deliverability: "UNKNOWN", qualityScore: 0.4, isSmtpValid: false, isMxFound: false,
        isDisposableEmail: true, isCatchallEmail: true })),
      hunter: okS(hunter({ result: "risky", score: 55, smtpCheck: false, disposable: true, acceptAll: true, block: true, gibberish: true })),
    })} />);
    expect(screen.getAllByText("PRIVACY").length).toBeGreaterThan(0);
    expect(screen.getByText(/YES: Encrypted \/ Anonymous/)).toBeTruthy(); // privacy InfoRow YES
    // classification Webmail row = No
    expect(screen.getByText("Webmail").nextElementSibling?.textContent).toBe("No");
    expect(screen.getAllByText("LOW").length).toBeGreaterThan(0); // reputation low
  });
});

describe("<EmailResultsDashboard> unified breach + export", () => {
  it("uses the server's enriched union and credential exposure in the panels", () => {
    render(<EmailResultsDashboard data={data({
      leakCheck: okS({ found: 2, fields: ["password"], sources: [
        { name: "Adobe", date: "2013-10-04" }, { name: "Canva", date: "2019-05-24" },
      ] }),
      breachAggregate: {
        breaches: [
          { name: "Canva", key: "canva", domain: "canva.com", date: "2019-05-24",
            dataClasses: ["Passwords", "Email addresses"], records: 137_000_000,
            password: true, verified: true, reportedBy: ["LeakCheck"], enriched: true },
          { name: "Adobe", key: "adobe", domain: "adobe.com", date: "2013-10-04",
            dataClasses: ["Passwords"], records: 152_000_000,
            password: true, verified: true, reportedBy: ["LeakCheck"], enriched: true },
        ],
        total: 2, sourcesReporting: ["LeakCheck"], sourcesAnswered: ["LeakCheck"],
        withPassword: 2, verified: 2, dataClasses: ["Passwords", "Email addresses"],
        firstBreach: "2013-10-04", lastBreach: "2019-05-24",
        timeline: [{ year: "2013", count: 1 }, { year: "2019", count: 1 }],
        enrichedCount: 2, passwordFieldsSeen: false,
      },
      credentialExposure: {
        distinctPasswords: 2, pairs: 5, capped: true, samples: ["h*****2"],
        passwordBreaches: 2, stealerLogs: 3, stealerPasswords: 2, exposed: true, reuse: "likely",
      },
    })} />);
    // The dashboard prefers the server union + credential-exposure over a recompute.
    expect(screen.getByText(/2 BREACHES/)).toBeTruthy();
    expect(screen.getByText(/Breach timeline/)).toBeTruthy();
    expect(screen.getByText("PASSWORD REUSE LIKELY")).toBeTruthy();
    expect(screen.getByText("h*****2")).toBeTruthy();
    expect(screen.getByText(/3 infostealer logs captured 2 distinct passwords/)).toBeTruthy();
  });

  it("offers the uniform report export control every mode shares", () => {
    render(<EmailResultsDashboard data={data({ xon: okS(xonD()) })} />);
    // The bespoke email report is gone; the shared four-format exporter replaces it.
    expect(screen.getByText("Markdown")).toBeTruthy();
    expect(screen.getByText("STIX 2.1")).toBeTruthy();
  });

  it("marks a not-found source empty, renders a deliverable Hunter result, and hides empty enrichment", () => {
    render(<EmailResultsDashboard data={data({
      hunter: okS(hunter()),                                 // deliverable, score 95 → high-confidence accent
      breachDirectory: { ok: false, error: "NOT_FOUND" },    // srState → "empty"
      fullContact: okS(fc({ profiles: [], otherEmails: [], phones: [], employment: [], age: null, gender: null })), // panel guard all-false
    })} />);
    expect(screen.getByText("95/100")).toBeTruthy();          // Hunter confidence (score > 70 accent)
    expect(screen.getAllByText(/DELIVERABLE/).length).toBeGreaterThan(0); // Hunter deliverable result accent
    expect(screen.queryByText(/FULLCONTACT ENRICHMENT/)).toBeNull();       // enrichment panel hidden when empty
  });

  it("copies the email and domain", () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    try {
      render(<EmailResultsDashboard data={data()} />);
      act(() => { fireEvent.click(screen.getAllByText("COPY")[0]!.closest("button")!); });
      expect(writeText).toHaveBeenCalledWith("ada.lovelace@gmail.com");
      act(() => { vi.advanceTimersByTime(1600); });
    } finally { vi.runOnlyPendingTimers(); vi.useRealTimers(); }
  });
});

describe("<EmailResultsDashboard> mail exchange (MX) card", () => {
  it("names a recognized mail provider and lists the exchangers", () => {
    render(<EmailResultsDashboard data={data({
      mail: okS({ hasMx: true, mxHosts: ["aspmx.l.google.com", "alt1.aspmx.l.google.com"], provider: "Google Workspace", category: "google" }),
    })} />);
    expect(screen.getByText("MAIL EXCHANGE (MX): keyless")).toBeTruthy();
    expect(screen.getByText("Google Workspace")).toBeTruthy();
    expect(screen.getByText("aspmx.l.google.com, alt1.aspmx.l.google.com")).toBeTruthy();
    expect(screen.getByText(/Describes the domain's mail host, not that this address is valid\./)).toBeTruthy();
  });

  it("flags a self-managed or unrecognized provider", () => {
    render(<EmailResultsDashboard data={data({
      mail: okS({ hasMx: true, mxHosts: ["mail.self.test"], provider: "Self-managed or unrecognized provider", category: "other" }),
    })} />);
    expect(screen.getByText("Self-managed or unrecognized provider")).toBeTruthy();
  });

  it("states an honest absence when no MX records are published", () => {
    render(<EmailResultsDashboard data={data({
      mail: okS({ hasMx: false, mxHosts: [], provider: "No published mail exchangers", category: "none" }),
    })} />);
    expect(screen.getByText("No published MX records")).toBeTruthy();
  });

  it("reports an MX lookup failure rather than a false clean", () => {
    render(<EmailResultsDashboard data={data({ mail: { ok: false, error: "timed out" } })} />);
    expect(screen.getByText("MX lookup unavailable")).toBeTruthy();
  });

  it("omits the card entirely for a response cached before the field existed", () => {
    render(<EmailResultsDashboard data={data()} />);
    expect(screen.queryByText("MAIL EXCHANGE (MX): keyless")).toBeNull();
  });

});
