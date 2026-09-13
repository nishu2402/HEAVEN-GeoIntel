// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import CasesPanel from "@/components/cases/CasesPanel";
import ResultsDashboard from "@/components/dashboard/ResultsDashboard";
import DomainResultsDashboard from "@/components/network/DomainResultsDashboard";
import AddToCase from "@/components/shared/AddToCase";
import ResolvedIdentityCard from "@/components/username/ResolvedIdentityCard";
import WalletResultsDashboard from "@/components/wallet/WalletResultsDashboard";
import EmailResultsDashboard from "@/components/email/EmailResultsDashboard";
import { installResizeObserver } from "./testUtils";
import type { DomainLookupResponse, EmailLookupResponse, LookupResponse, WalletLookupResponse } from "@/lib/types";

installResizeObserver();
beforeEach(() => { cleanup(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A fetch that answers the endpoints these panels talk to. */
function stubApi(routes: Record<string, unknown>) {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const s = String(url);
    calls.push({ url: s, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const key = Object.keys(routes).find((k) => s.includes(k));
    return {
      ok: true, status: 200,
      json: async () => (key ? routes[key] : {}),
      text: async () => "",
    } as Response;
  }));
  return calls;
}

describe("the change inbox reaches the cases screen", () => {
  it("renders unread changes and marks them read", async () => {
    const inbox = {
      changes: [{
        caseId: "c1", caseName: "Case One", kind: "domain" as const, value: "a.test",
        at: Date.now(), fact: "subdomains", from: 3, to: 9, cacheInvolved: true, unread: true,
      }],
      unread: 1, baselines: 0,
    };
    const calls = stubApi({
      "/api/cases": { cases: [{ id: "c1", name: "Case One", createdAt: 1, updatedAt: 2, entities: [] }], inbox },
    });

    render(<CasesPanel />);
    await waitFor(() => expect(screen.getByText(/CHANGES: 1 unread of 1/)).toBeTruthy());
    expect(screen.getByText(/subdomains: 3 → 9/)).toBeTruthy();
    expect(screen.getByText("cached side")).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByText(/Mark all read/)); });
    expect(calls.some((c) => (c.body as { action?: string } | undefined)?.action === "markReviewed")).toBe(true);
  });
});

describe("the two score bars explain themselves", () => {
  const phone = (over: Partial<LookupResponse> = {}): LookupResponse => ({
    input: { raw: "+14155552671", e164: "+14155552671", national: "(415) 555-2671", country: "US", countryCallingCode: "+1", region: null, isValid: true, isPossible: true, type: "MOBILE" },
    analysis: { countryName: "United States", country: "US", timezones: [], utcOffsets: [], type: "MOBILE", typeDescription: "Mobile", isValid: true, isMobile: true } as never,
    countryIntel: null,
    offline: { riskScore: 0, signals: [], summary: "" } as never,
    sources: {
      numverify: { ok: false, error: "NOT_CONFIGURED" }, ipqs: { ok: false, error: "NOT_CONFIGURED" },
      abstract: { ok: false, error: "NOT_CONFIGURED" }, twilio: { ok: false, error: "NOT_CONFIGURED" },
      breachDirectory: { ok: false, error: "NOT_CONFIGURED" }, fullContact: { ok: false, error: "NOT_CONFIGURED" },
      hudsonRock: { ok: true, data: { total: 0, stealers: [] } }, leakCheck: { ok: true, data: { found: 0, fields: [], sources: [] } },
    },
    aggregated: {
      carrier: null, lineType: "mobile", typeDescription: "Mobile", country: "US", countryName: "United States",
      region: null, timezone: null, utcOffsets: null, isValid: true, fraudScore: null, isVoip: null, isMobile: true,
      isFixedLine: null, isAmbiguousType: false, isTollFree: null, isPremiumRate: null, isDisposable: null,
      isRisky: null, recentAbuse: null, carrierPrefix: null, areaCode: "415", numberLength: 11,
      formatE164: "+14155552671", formatInternational: "+1 415 555 2671", formatNational: "(415) 555-2671",
      formatRfc3966: "tel:+1-415-555-2671", callerName: null, callerType: null, prepaid: null, active: null,
      activeStatus: null, userActivity: null, mobileCountryCode: null, mobileNetworkCode: null,
      associatedEmails: null, city: null,
    },
    threatScore: 0, threatLabel: "CLEAN",
    ...over,
  });

  it("lists the reasons behind each figure", () => {
    render(<ResultsDashboard data={phone({
      threatScore: 25, threatLabel: "MODERATE", threatReasons: ["confirmed VOIP line"],
      exposureScore: 46, exposureLabel: "SIGNIFICANT", exposureReasons: ["named in 3 breaches", "11 indexed breach records"],
    })} />);
    expect(screen.getByText("· confirmed VOIP line")).toBeTruthy();
    expect(screen.getByText("· named in 3 breaches")).toBeTruthy();
    expect(screen.getByText("· 11 indexed breach records")).toBeTruthy();
    expect(screen.getByText("Abuse Risk")).toBeTruthy();
    expect(screen.getByText("Exposure")).toBeTruthy();
  });

  it("colours an unscored figure amber rather than clean-green", () => {
    render(<ResultsDashboard data={phone({ threatScore: 0, threatLabel: "NOT ASSIGNABLE" })} />);
    expect(screen.getByText("NOT ASSIGNABLE")).toBeTruthy();
    // Exposure defaults to "not observed" rather than disappearing.
    expect(screen.getByText("NONE OBSERVED")).toBeTruthy();
  });
});

describe("the email panel's own recomputation", () => {
  const email = (over: Partial<EmailLookupResponse> = {}): EmailLookupResponse => ({
    email: "ada@example.test",
    analysis: {
      email: "ada@example.test", username: "ada", domain: "example.test", domainUnicode: "example.test",
      tld: "test", isValidFormat: true, providerType: "corporate", providerName: "Example (Corporate)",
      isDisposable: false, isWebmail: false, isPrivacyFocused: false, isRoleAddress: false, guessedName: "Ada",
    },
    gravatar: { found: false, displayName: null, preferredUsername: null, aboutMe: null, currentLocation: null, profileUrl: null, thumbnailUrl: null, accounts: [], verifiedAccounts: [] },
    emailrep: { ok: false }, hunter: { ok: false }, abstract: { ok: false }, xon: { ok: false },
    breachDirectory: { ok: false }, fullContact: { ok: false }, hudsonRock: { ok: false },
    leakCheck: { ok: false }, comb: { ok: false }, hibp: { ok: false },
    ...over,
  });

  it("counts COMB credential pairs as exposure when the server sent no figures", () => {
    render(<EmailResultsDashboard data={email({
      comb: { ok: true, data: { pairs: 3, distinctPasswords: 2, capped: false, samples: ["a***"] } },
    })} />);
    expect(screen.getByText(/3 credential records recovered/)).toBeTruthy();
  });

  it("shows an unscored exposure figure in the glance row", () => {
    render(<EmailResultsDashboard data={email({
      threatScore: 0, threatLabel: "CLEAN", threatReasons: [],
      exposureScore: 0, exposureLabel: "NOT ASSESSED", exposureReasons: [],
    })} />);
    expect(screen.getByText("NOT ASSESSED")).toBeTruthy();
  });
});

describe("domain, wallet and identity panels in their remaining states", () => {
  const domain = (over: Partial<DomainLookupResponse>): DomainLookupResponse => ({
    domain: "a.test", isValid: true,
    dns: { a: [], aaaa: [], mx: [], txt: [], ns: [], cname: [] },
    whois: null, subdomains: [], emailSecurity: { hasSpf: null, spf: null, hasDmarc: null, dmarcPolicy: null, hasMx: null, nullMx: false },
    dnssec: null, wayback: null, http: null, pivots: [], ...over,
  } as DomainLookupResponse);

  it("dims a discovered subdomain that resolves to nothing", () => {
    render(<DomainResultsDashboard data={domain({
      subdomains: ["live.a.test", "stale.a.test", "unchecked.a.test"],
      subdomainHosts: [
        { host: "live.a.test", addresses: ["1.1.1.1"] },
        { host: "stale.a.test", addresses: [] },
      ],
    })} />);
    expect(screen.getByText("live.a.test").getAttribute("title")).toBe("1.1.1.1");
    expect(screen.getByText("stale.a.test").getAttribute("title")).toBe("resolves to nothing");
    expect(screen.getByText("unchecked.a.test").getAttribute("title")).toBe("not resolved");
  });

  it("says when a sanctioned entity is listed under no named programme", () => {
    render(<WalletResultsDashboard data={{
      input: "1abc", chain: "btc", facts: null, pivots: [],
      sanctions: {
        listed: true,
        matches: [{ ticker: "XBT", address: "1abc", entity: "UNKNOWN ENTITY", uid: "1", programs: [], entityType: "-0-" }],
        source: "OFAC", snapshotDate: "2026-09-12", listSize: 1056,
      },
      activity: { lastActivity: "2020-01-01", oldestSampled: "2020-01-01", sampled: 1, counterparties: 0, capped: false },
    } as unknown as WalletLookupResponse} />);
    expect(screen.getByText(/programs unspecified/)).toBeTruthy();
    // The sample note says exactly how far it goes, and no further.
    expect(screen.getByText(/From the most recent 1 transactions/)).toBeTruthy();
  });

  it("says 'no account' when an identity rests on nothing at all", () => {
    render(<ResolvedIdentityCard
      identity={{ names: [], locations: [], avatars: [], bios: [] }}
      resolved={{
        name: { value: "Ghost", sources: [], agreement: 0, total: 0 },
        location: null, avatar: null, confidence: 10, label: "low",
        cluster: { platforms: [], proofs: [] }, unlinked: [], conflicts: [],
      }}
    />);
    expect(screen.getByText("from no account")).toBeTruthy();
  });
});

describe("pinning a result also preserves it", () => {
  it("captures the response into the case's evidence locker", async () => {
    const calls = stubApi({
      "/api/cases": { cases: [{ id: "c1", name: "Case One", entities: [] }], case: { id: "c1", name: "Case One", entities: [] } },
      "/api/evidence": { entry: { id: "abc" } },
    });

    render(<AddToCase
      entities={[{ kind: "domain", value: "a.test" }]}
      evidence={{ mode: "domain", identifier: "a.test", payload: { domain: "a.test" } }}
    />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /add to case/i })); });
    await waitFor(() => expect(screen.getByText("Case One")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByText("Case One")); });

    await waitFor(() => {
      const capture = calls.find((c) => c.url.includes("/api/evidence"));
      expect(capture).toBeTruthy();
      expect((capture!.body as { action: string }).action).toBe("capture");
    });
  });
});

describe("bulk triage in its running and empty states", () => {
  it("shows progress, stops on request, and says when nothing was found", async () => {
    const BulkLookup = (await import("@/components/dashboard/BulkLookup")).default;
    let polls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ id: "j1", total: 2, state: "running", skipped: [] }) } as Response;
      }
      if (init?.method === "DELETE") {
        return { ok: true, status: 200, json: async () => ({ id: "j1", state: "cancelled" }) } as Response;
      }
      polls++;
      // First poll: still running. Second: cancelled with no rows at all.
      return {
        ok: true, status: 200,
        json: async () => polls === 1
          ? { id: "j1", state: "running", total: 2, done: 1, rows: [] }
          : { id: "j1", state: "cancelled", total: 2, done: 1, rows: [] },
      } as Response;
    }));

    render(<BulkLookup />);
    fireEvent.change(screen.getByLabelText(/bulk identifier input/i), { target: { value: "a.test\nb.test" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /run bulk lookup/i })); });

    // While it runs, the stop control is what is offered.
    const stop = await screen.findByRole("button", { name: /stop bulk lookup/i });
    await act(async () => { fireEvent.click(stop); });
    await act(async () => { await new Promise((r) => setTimeout(r, 1400)); });

    await waitFor(() => expect(screen.getByText(/No confirmed|CANCELLED/i)).toBeTruthy());
  });
});

describe("panel branches that a happy path does not reach", () => {
  it("colours an old look-alike differently from one registered last week", async () => {
    const TyposquatPanel = (await import("@/components/network/TyposquatPanel")).default;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        domain: "example.com", generated: 10, checked: 10, resolving: 1, withMail: 0, unanswered: 0,
        findings: [{
          domain: "exmple.com", technique: "omission", addresses: ["1.1.1.1"], mx: [],
          resolves: true, answered: true, whois: { registrar: "MarkMonitor Inc.", createdDate: "2009-05-09" }, ageDays: 6335,
        }],
      }),
    }) as Response));
    render(<TyposquatPanel domain="example.com" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Resolve every look-alike/ })); });
    expect(screen.getByText(/registered 6335d ago/)).toBeTruthy();
    expect(screen.getByText("MarkMonitor Inc.")).toBeTruthy();
  });

  it("keeps the pin when the evidence locker refuses the capture", async () => {
    const AddToCase = (await import("@/components/shared/AddToCase")).default;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("/api/evidence")) throw new Error("locker full");
      return {
        ok: true, status: 200,
        json: async () => ({ cases: [{ id: "c1", name: "Case One", entities: [] }] }),
      } as Response;
    }));
    render(<AddToCase
      entities={[{ kind: "domain", value: "a.test" }]}
      evidence={{ mode: "domain", identifier: "a.test", payload: { domain: "a.test" } }}
    />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /add to case/i })); });
    await waitFor(() => expect(screen.getByText("Case One")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByText("Case One")); });
    // The pin still reports success: preservation is best-effort and must not
    // undo the thing the analyst actually asked for.
    await waitFor(() => expect(screen.getByText(/PINNED/)).toBeTruthy());
  });

  it("renders a bulk row's HTTP status when the failure carried no message", async () => {
    const BulkLookup = (await import("@/components/dashboard/BulkLookup")).default;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ id: "j", total: 1, state: "running", skipped: [] }) } as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          id: "j", state: "done", total: 1, done: 1,
          rows: [{ mode: "ip", input: "x", ok: false, status: 500, summary: {}, sources: [], ms: 1 }],
        }),
      } as Response;
    }));
    render(<BulkLookup />);
    fireEvent.change(screen.getByLabelText(/bulk identifier input/i), { target: { value: "x" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /run bulk lookup/i })); });
    await waitFor(() => expect(screen.getByText("HTTP 500")).toBeTruthy());
  });

  it("downloads the rows it has, as CSV", async () => {
    const BulkLookup = (await import("@/components/dashboard/BulkLookup")).default;
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ id: "j2", total: 1, state: "running", skipped: [] }) } as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          id: "j2", state: "done", total: 1, done: 1,
          rows: [{ mode: "domain", input: "a.test", ok: true, status: 200, summary: { domain: "a.test" }, sources: [], ms: 1 }],
        }),
      } as Response;
    }));
    render(<BulkLookup />);
    fireEvent.change(screen.getByLabelText(/bulk identifier input/i), { target: { value: "a.test" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /run bulk lookup/i })); });
    await waitFor(() => expect(screen.getByRole("button", { name: /download bulk results as csv/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /download bulk results as csv/i }));
    expect(clicks[0]).toMatch(/^bulk-j2\.csv$/);
  });

  it("recomputes email figures when the server sent only one half", async () => {
    const EmailResultsDashboard = (await import("@/components/email/EmailResultsDashboard")).default;
    const base = {
      email: "ada@example.test",
      analysis: {
        email: "ada@example.test", username: "ada", domain: "example.test", domainUnicode: "example.test",
        tld: "test", isValidFormat: true, providerType: "corporate", providerName: "Example (Corporate)",
        isDisposable: false, isWebmail: false, isPrivacyFocused: false, isRoleAddress: false, guessedName: "Ada",
      },
      gravatar: { found: false, displayName: null, preferredUsername: null, aboutMe: null, currentLocation: null, profileUrl: null, thumbnailUrl: null, accounts: [], verifiedAccounts: [] },
      emailrep: { ok: false }, hunter: { ok: false }, abstract: { ok: false }, xon: { ok: false },
      breachDirectory: { ok: false }, fullContact: { ok: false }, hudsonRock: { ok: false },
      leakCheck: { ok: false }, comb: { ok: true, data: undefined }, hibp: { ok: false },
    } as unknown as EmailLookupResponse;

    // Only the abuse half present: the panel recomputes rather than showing a
    // half-filled pair.
    render(<EmailResultsDashboard data={{ ...base, threatScore: 40 } as EmailLookupResponse} />);
    expect(screen.getByText("Abuse Risk")).toBeTruthy();
    cleanup();

    // Both present but unlabelled, which a cached response can be.
    render(<EmailResultsDashboard data={{ ...base, threatScore: 75, exposureScore: 75 } as EmailLookupResponse} />);
    expect(screen.getAllByText("75").length).toBeGreaterThan(0);
  });
});

describe("the bulk panel's guard rails", () => {
  it("refuses to start a job when the box holds only whitespace", async () => {
    const BulkLookup = (await import("@/components/dashboard/BulkLookup")).default;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<BulkLookup />);
    fireEvent.change(screen.getByLabelText(/bulk identifier input/i), { target: { value: "  \n , ; " } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /run bulk lookup/i })); });
    expect(screen.getByText("Paste some identifiers first.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the mode the analyst picked instead of guessing per row", async () => {
    const BulkLookup = (await import("@/components/dashboard/BulkLookup")).default;
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        bodies.push(JSON.parse(init.body as string));
        return { ok: true, status: 200, json: async () => ({ id: "j5", total: 1, state: "done", skipped: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ id: "j5", state: "done", total: 1, done: 1, rows: [] }) } as Response;
    }));
    render(<BulkLookup />);
    fireEvent.change(screen.getByLabelText(/bulk identifier input/i), { target: { value: "torvalds" } });
    fireEvent.change(screen.getByLabelText("mode"), { target: { value: "username" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /run bulk lookup/i })); });
    expect(bodies[0]).toEqual({ items: ["torvalds"], mode: "username" });
  });

  it("treats a start response with no skipped list as nothing skipped", async () => {
    const BulkLookup = (await import("@/components/dashboard/BulkLookup")).default;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        // No `skipped` key at all, which is what an older server sends.
        return { ok: true, status: 200, json: async () => ({ id: "j3", total: 1, state: "running" }) } as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ id: "j3", state: "done", total: 1, done: 1, rows: [{ mode: "ip", input: "8.8.8.8", ok: true, status: 200, summary: {}, sources: [], ms: 2 }] }),
      } as Response;
    }));
    render(<BulkLookup />);
    fireEvent.change(screen.getByLabelText(/bulk identifier input/i), { target: { value: "8.8.8.8" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /run bulk lookup/i })); });
    await waitFor(() => expect(screen.getByRole("button", { name: /download bulk results as csv/i })).toBeTruthy());
    expect(screen.queryByText(/skipped/i)).toBeNull();
  });

  it("does nothing when Stop is pressed before the server has named the job", async () => {
    const BulkLookup = (await import("@/components/dashboard/BulkLookup")).default;
    let release: (() => void) | null = null;
    const held = new Promise<void>((r) => { release = r; });
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        await held;
        return { ok: true, status: 200, json: async () => ({ id: "j4", total: 1, state: "done", skipped: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ id: "j4", state: "done", total: 1, done: 1, rows: [] }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<BulkLookup />);
    fireEvent.change(screen.getByLabelText(/bulk identifier input/i), { target: { value: "8.8.8.8" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /run bulk lookup/i })); });

    // The job is in flight and has no id yet, so Stop has nothing to cancel.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /stop bulk lookup/i })); });
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    await act(async () => { release?.(); await held; });
  });
});

describe("email figures when the stealer-log source answered", () => {
  it("counts infections into exposure rather than into abuse", async () => {
    const EmailResultsDashboard = (await import("@/components/email/EmailResultsDashboard")).default;
    render(<EmailResultsDashboard data={{
      email: "ada@example.test",
      analysis: {
        email: "ada@example.test", username: "ada", domain: "example.test", domainUnicode: "example.test",
        tld: "test", isValidFormat: true, providerType: "corporate", providerName: "Example (Corporate)",
        isDisposable: false, isWebmail: false, isPrivacyFocused: false, isRoleAddress: false, guessedName: "Ada",
      },
      gravatar: { found: false, displayName: null, preferredUsername: null, aboutMe: null, currentLocation: null, profileUrl: null, thumbnailUrl: null, accounts: [], verifiedAccounts: [] },
      emailrep: { ok: false }, hunter: { ok: false }, abstract: { ok: false }, xon: { ok: false },
      breachDirectory: { ok: false }, fullContact: { ok: false },
      hudsonRock: { ok: true, data: { total: 2, stealers: [] } },
      leakCheck: { ok: false }, comb: { ok: false }, hibp: { ok: false },
    } as unknown as EmailLookupResponse} />);
    // 70 is the stealer-infection floor, plus 5 per captured machine.
    expect(screen.getByText("80")).toBeTruthy();
    expect(screen.getByText(/captured by 2 infostealer infections/)).toBeTruthy();
  });
});
