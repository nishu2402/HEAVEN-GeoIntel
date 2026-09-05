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

describe("<EmailResultsDashboard> report export", () => {
  const capture = () => {
    let text = "";
    const realBlob = globalThis.Blob;
    vi.stubGlobal("Blob", class extends realBlob {
      constructor(parts: BlobPart[], opts?: BlobPropertyBag) { super(parts, opts); text = parts.map(String).join(""); }
    });
    const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    let name = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { if (this.download) name = this.download; });
    return { get text() { return text; }, get name() { return name; }, restore: () => { URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; } };
  };

  it("exports a full report when every source has data", () => {
    const cap = capture();
    try {
      render(<EmailResultsDashboard data={data({
        xon: okS(xonD()), breachDirectory: okS({ found: 1, fields: ["password"], sources: ["LinkedIn"],
          results: [{ password: "pa**", sha1: "abc", hash: "def", sources: ["LinkedIn"] }] }),
        fullContact: okS(fc()), gravatar: gravatar({ found: true, displayName: "Ada", accounts: [{ shortname: "gh", username: "ada", url: "u" }] }),
        emailrep: okS(rep()), abstract: okS(abstract()), hunter: okS(hunter()),
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      expect(cap.name).toMatch(/^email_intel_ada\.lovelace_at_gmail\.com_\d+\.txt$/);
      expect(cap.text).toContain("Email Intelligence Report");
      expect(cap.text).toContain("UNIFIED BREACH VIEW: all sources merged");
      expect(cap.text).toContain("Unique Breaches : 1");
      expect(cap.text).toContain("BREACH LIST:");
      expect(cap.text).toContain("CREDENTIAL LIST:");
      expect(cap.text).toContain("Full Name       : Ada Lovelace");
      expect(cap.text).toContain("[CURRENT] Acme: Analyst");
      expect(cap.text).toContain("REPUTATION: EmailRep.io");
    } finally { cap.restore(); }
  });

  it("uses the server's enriched union + credential exposure in the panel and the report", () => {
    const cap = capture();
    try {
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
      // Panel: server union (with the timeline) + credential-reuse verdict.
      expect(screen.getByText(/2 BREACHES/)).toBeTruthy();
      expect(screen.getByText(/Breach timeline/)).toBeTruthy();
      expect(screen.getByText("PASSWORD REUSE LIKELY")).toBeTruthy();
      expect(screen.getByText("h*****2")).toBeTruthy();
      expect(screen.getByText(/3 infostealer logs captured 2 distinct passwords/)).toBeTruthy();
      // Report: the same numbers, from the server's aggregate, not a recompute.
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      expect(cap.text).toContain("Unique Breaches : 2");
      expect(cap.text).toContain("Catalog Enriched: 2 (HIBP offline catalog)");
      expect(cap.text).toContain("Assessment      : PASSWORD REUSE LIKELY");
      expect(cap.text).toContain("Leaked Passwords : at least 2 distinct (5 pairs, masked)");
      expect(cap.text).toContain("Stealer Captures : 2 distinct across 3 infostealer logs (masked)");
    } finally { cap.restore(); }
  });

  it("reports an exact leaked-password count when the source did not truncate", () => {
    const cap = capture();
    try {
      render(<EmailResultsDashboard data={data({
        credentialExposure: {
          distinctPasswords: 3, pairs: 4, capped: false, samples: ["a***e"],
          passwordBreaches: 1, stealerLogs: 0, stealerPasswords: 0, exposed: true, reuse: "exposed",
        },
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      expect(cap.text).toContain("Assessment      : PASSWORD EXPOSED");
      expect(cap.text).toContain("Leaked Passwords : 3 distinct (4 pairs, masked)"); // no "at least"
      expect(cap.text).not.toContain("Stealer Captures");                            // none captured
    } finally { cap.restore(); }
  });

  it("exports the keyless Hudson Rock and LeakCheck sections in full", () => {
    const cap = capture();
    try {
      render(<EmailResultsDashboard data={data({
        hudsonRock: okS({ total: 2, stealers: [
          { computerName: "DESKTOP-1", operatingSystem: "Windows 11", malwareFamily: "Acreed",
            dateCompromised: "2026-07-25T00:00:00Z", ip: "8.8.8.8",
            topPasswords: ["p***d"], topLogins: ["a@b.com"] },
          { computerName: null, operatingSystem: null, malwareFamily: null,
            dateCompromised: null, ip: null, topPasswords: [], topLogins: [] },
        ] }),
        leakCheck: okS({ found: 12, fields: ["password", "phone"], sources: [
          { name: "Trello.com", date: "2024-01" }, { name: "Vivagames.com", date: null },
        ] }),
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      expect(cap.text).toContain("INFOSTEALER EXPOSURE: Hudson Rock (free, no key)");
      expect(cap.text).toContain("Infections      : 2");
      expect(cap.text).toContain("Malware  : Acreed");
      expect(cap.text).toContain("IP       : 8.8.8.8");
      expect(cap.text).toContain("Logins   : a@b.com");
      // The second stealer has no detail fields — its optional lines vanish
      // rather than printing "Malware  : null".
      expect(cap.text).toContain("[2] Malware  : unknown");
      expect(cap.text).toContain("PUBLIC BREACH INDEX: LeakCheck (free, no key)");
      expect(cap.text).toContain("Records         : 12");
      expect(cap.text).toContain("Exposed Fields  : password, phone");
      expect(cap.text).toContain("Trello.com (2024-01), Vivagames.com");
    } finally { cap.restore(); }
  });

  it("exports the clean and failed states for the keyless sources", () => {
    const cap = capture();
    try {
      const { unmount } = render(<EmailResultsDashboard data={data({
        hudsonRock: okS({ total: 0, stealers: [] }),
        leakCheck: okS({ found: 0, fields: [], sources: [] }),
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      expect(cap.text).toContain("Result          : CLEAN: no infostealer infections recorded");
      expect(cap.text).toContain("Result          : NOT INDEXED: no breach records for this address");
      unmount();

      const { unmount: unmount2 } = render(<EmailResultsDashboard data={data({
        hudsonRock: { ok: false },
        leakCheck: { ok: false, error: "RATE_LIMITED" },
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      // Both fall back to N/A when a source failed without naming a reason.
      expect(cap.text).toContain("Status          : N/A");
      expect(cap.text).toContain("Status          : RATE_LIMITED");
      unmount2();

      render(<EmailResultsDashboard data={data({
        hudsonRock: { ok: false, error: "RATE_LIMITED" },
        leakCheck: { ok: false },
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      expect(cap.text).toContain("Status          : RATE_LIMITED");
      expect(cap.text).toContain("Status          : N/A");
    } finally { cap.restore(); }
  });

  it("prints N/A for a LeakCheck hit that named no fields or breaches", () => {
    const cap = capture();
    try {
      render(<EmailResultsDashboard data={data({
        leakCheck: okS({ found: 4, fields: [], sources: [] }),
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      expect(cap.text).toContain("Exposed Fields  : N/A");
      expect(cap.text).toContain("Named Breaches  : N/A");
    } finally { cap.restore(); }
  });

  it("prints the unified breach total but omits exposed types when none are known", () => {
    const cap = capture();
    try {
      render(<EmailResultsDashboard data={data({
        leakCheck: okS({ found: 5, fields: [], sources: [
          { name: "Foo.com", date: "2020-01" }, { name: "Bar.net", date: null },
        ] }),
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      expect(cap.text).toContain("UNIFIED BREACH VIEW: all sources merged");
      expect(cap.text).toContain("Unique Breaches : 2");
      expect(cap.text).toContain("Sources         : LeakCheck");
      expect(cap.text).not.toContain("Exposed Types");
    } finally { cap.restore(); }
  });

  it("exports the not-configured / clean fallbacks when sources are empty", () => {
    const cap = capture();
    try {
      render(<EmailResultsDashboard data={data({
        xon: okS(xonD({ breachCount: 0, breaches: [], xposedDataTypes: [] })), // CLEAN
        breachDirectory: off(), fullContact: { ok: false, error: "NOT_FOUND" },
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      expect(cap.text).toContain("CLEAN: no breaches found");
      expect(cap.text).toContain("NOT CONFIGURED: add RAPIDAPI_KEY");
      expect(cap.text).toContain("No record found for this email");
    } finally { cap.restore(); }
  });

  it("exports the opposite polarity of every field and sorts multiple breaches", () => {
    const cap = capture();
    try {
      render(<EmailResultsDashboard data={data({
        analysis: analysis({ isDisposable: true, isPrivacyFocused: true, isRoleAddress: true, guessedName: null,
          providerType: "disposable", providerName: "Mailinator" }),
        // two breaches → the sort comparator runs; one with an empty domain + verified:false
        xon: okS(xonD({ breachCount: 2, breaches: [
          { breach: "Older", xposedData: ["Passwords"], xposedDate: "2011-01-01", xposedRecords: 5, domain: "", passwordRisk: "StrongHash", verified: false },
          { breach: "Newer", xposedData: ["Email addresses"], xposedDate: "2020-01-01", xposedRecords: 9, domain: "n.com", passwordRisk: "Unknown", verified: true },
        ] })),
        // credential entry with all hash fields empty → the r.password/sha1/hash falsy arms
        breachDirectory: okS({ found: 1, fields: [], sources: ["X"], results: [{ password: "", sha1: "", hash: "", sources: [] }] }),
        // fullContact present but every optional field null/empty → all "?? N/A" + empty-collection arms
        fullContact: okS(fc({ fullName: null, title: null, organization: null, location: null, age: null, gender: null,
          bio: null, profiles: [], otherEmails: [], phones: [], employment: [] })),
        gravatar: gravatar({ found: true, displayName: null, preferredUsername: null, currentLocation: null,
          aboutMe: null, profileUrl: null, accounts: [] }),
        emailrep: okS(rep({ suspicious: true, credentialsLeaked: true, dataBreach: true, maliciousActivity: true,
          spam: true, deliverable: false, firstSeen: null, lastSeen: null, profiles: [] })),
        abstract: okS(abstract({ isSmtpValid: false, isMxFound: false })),
        hunter: okS(hunter({ smtpCheck: false })),
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      const t = cap.text;
      expect(t).toContain("Disposable      : YES");
      expect(t).toContain("Privacy Provider: YES");
      expect(t).toContain("Role Address    : YES");
      expect(t).toContain("Guessed Name    : N/A");
      expect(t).toContain("Full Name       : N/A");        // fc null fields
      expect(t).toContain("Credentials Leaked: YES: CRITICAL");
      expect(t.indexOf("Newer")).toBeLessThan(t.indexOf("Older")); // sorted newest-first
      expect(t).toContain("Linked Accounts : None");        // empty gravatar accounts
    } finally { cap.restore(); }
  });

  it("exports the error-state status lines when sources failed with a message", () => {
    const cap = capture();
    try {
      render(<EmailResultsDashboard data={data({
        xon: { ok: false, error: "boom" },                    // Total Breaches N/A + Result: boom
        breachDirectory: { ok: true, data: { found: 0, fields: [], sources: [], results: [] } }, // CLEAN: no credentials
        fullContact: { ok: false, error: "weird" },           // generic FC error
        emailrep: { ok: false, error: "rep-down" },
        abstract: { ok: false, error: "abs-down" },
        hunter: { ok: false, error: "hun-down" },
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      const t = cap.text;
      expect(t).toContain("Total Breaches  : N/A");
      expect(t).toContain("Result          : boom");
      expect(t).toContain("CLEAN: no credentials found in BreachDirectory");
      expect(t).toContain("IDENTITY: FullContact Person Enrichment");
      expect(t).toMatch(/Status          : weird/);          // FC generic error ?? N/A
      expect(t).toMatch(/Status          : rep-down/);
      expect(t).toMatch(/Status          : abs-down/);
      expect(t).toMatch(/Status          : hun-down/);
    } finally { cap.restore(); }
  });

  it("exports N/A / No-data fallbacks when sources failed without a message", () => {
    const cap = capture();
    try {
      render(<EmailResultsDashboard data={data({
        xon: { ok: false },                                   // Result: N/A
        breachDirectory: { ok: false, error: "unlabeled" },   // BD generic error ?? N/A
        fullContact: { ok: false },                           // FC N/A
        emailrep: { ok: true, data: undefined } as never,     // emailrep.ok but no data → "No data"
        abstract: { ok: false },                              // abstract N/A
        hunter: { ok: false },                                // hunter N/A
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      const t = cap.text;
      expect(t).toContain("Result          : N/A");
      expect(t).toMatch(/Status          : unlabeled/);
      expect(t).toMatch(/Status          : No data/);          // emailrep ok-but-empty
    } finally { cap.restore(); }
  });

  it("exports the FullContact not-configured line and the bare error fallbacks", () => {
    const cap = capture();
    try {
      render(<EmailResultsDashboard data={data({
        xon: okS(xonD({ breachCount: 0, breaches: [], xposedDataTypes: [] })),
        breachDirectory: { ok: false },                     // no error string → BD status ?? N/A
        fullContact: { ok: false, error: "NOT_CONFIGURED" }, // FC "NOT CONFIGURED: add FULLCONTACT_API_KEY"
        emailrep: { ok: false },                            // no error → emailrep status ?? "Error"
      })} />);
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      const t = cap.text;
      expect(t).toContain("NOT CONFIGURED: add FULLCONTACT_API_KEY to .env.local");
      expect(t).toMatch(/Status          : N\/A/);           // BD error-less fallback
      expect(t).toMatch(/Status          : Error/);          // emailrep error-less fallback
    } finally { cap.restore(); }
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
