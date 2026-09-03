// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { installMemoryLocalStorage, installResizeObserver } from "./testUtils";
import UsernameResultsDashboard from "@/components/username/UsernameResultsDashboard";
import type { UsernameLookupResponse, UsernameHit, SocialProfile } from "@/lib/types";

beforeAll(() => { installMemoryLocalStorage(); installResizeObserver(); });
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const hit = (site: string, status: UsernameHit["status"], category = "developer"): UsernameHit =>
  ({ site, category, url: `https://${site}/neo`, status });

const profile = (over: Partial<SocialProfile> = {}): SocialProfile => ({
  platform: "GitHub", category: "developer", handle: "neo", url: "https://github.com/neo",
  avatarUrl: "https://avatars.example/neo.png", displayName: "Neo Anderson", bio: "wakes up",
  stats: [{ label: "repos", value: "42" }], joinedYear: "2015", location: "Zion", extra: "Metacortex",
  ...over,
});

const resp = (over: Partial<UsernameLookupResponse> = {}): UsernameLookupResponse => ({
  username: "neo", checked: 20, found: 3, manual: 2,
  hits: [hit("github.com", "found"), hit("gitlab.com", "found", "developer"),
    hit("reddit.com", "found", "social"), hit("nitter.net", "manual", "social"),
    hit("keybase.io", "unknown", "developer"), hit("dead.site", "notfound", "developer")],
  profiles: [profile()],
  identity: {
    names: [{ value: "Neo Anderson", source: "GitHub" }],
    locations: [{ value: "Zion", source: "GitHub" }],
    avatars: [{ url: "https://avatars.example/neo.png", source: "GitHub" }],
    bios: [{ value: "wakes up", source: "GitHub" }],
  },
  pivots: [{ label: "Google dork", url: "https://google.com/search?q=neo" }],
  leakCheck: { ok: false, error: "NOT_CONFIGURED" },
  hudsonRock: { ok: false, error: "NOT_CONFIGURED" },
  ...over,
});

describe("<UsernameResultsDashboard>", () => {
  it("renders the header, category tally, hit rate, identity signals and verified profiles", () => {
    const { container } = render(<UsernameResultsDashboard data={resp()} />);
    expect(screen.getAllByText("@neo").length).toBeGreaterThan(0);
    // confirmed = found(3) + profiles(1) = 4 — text is split across spans
    expect(container.textContent).toContain("4 confirmed accounts");
    expect(screen.getByText(/1 rich profile$/)).toBeTruthy();      // singular
    expect(screen.getByText(/2 to verify manually/)).toBeTruthy();
    expect(screen.getByText(/3\/20 sites · 15%/)).toBeTruthy();     // hit rate
    expect(screen.getByText(/IDENTITY SIGNALS/)).toBeTruthy();
    expect(screen.getAllByText("Neo Anderson").length).toBeGreaterThan(0); // name candidate + profile
    expect(screen.getAllByText("Zion").length).toBeGreaterThan(0);  // location (profile + identity)
    expect(screen.getByText(/VERIFIED PROFILES \(1\)/)).toBeTruthy();
    expect(screen.getByText("Metacortex")).toBeTruthy();            // profile extra
    expect(screen.getByText(/42/)).toBeTruthy();                    // stat
    expect(screen.getByText(/since 2015/)).toBeTruthy();
    // CLI commands
    expect(screen.getByText("sherlock neo")).toBeTruthy();
    expect(screen.getByText("maigret neo")).toBeTruthy();
  });

  it("toggles between FOUND-only and INCLUDE-TO-VERIFY filters", () => {
    render(<UsernameResultsDashboard data={resp()} />);
    // default "found" filter hides the manual + unknown sites
    expect(screen.queryByText("nitter.net")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /include to-verify/i }));
    expect(screen.getByText("nitter.net")).toBeTruthy();     // manual now shown → VERIFY →
    expect(screen.getByText("keybase.io")).toBeTruthy();     // unknown now shown → UNVERIFIED
    expect(screen.getAllByText("VERIFY →").length).toBeGreaterThan(0);   // badge + legend
    expect(screen.getAllByText("UNVERIFIED").length).toBeGreaterThan(0); // badge + legend
    // still hides the notfound site
    expect(screen.queryByText("dead.site")).toBeNull();
  });

  it("copies a CLI command, flips the button to COPIED, then reverts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.useFakeTimers();
    try {
      render(<UsernameResultsDashboard data={resp()} />);
      const copyBtn = screen.getByRole("button", { name: /copy sherlock neo/i });
      await act(async () => { fireEvent.click(copyBtn); });
      expect(writeText).toHaveBeenCalledWith("sherlock neo");
      expect(within(copyBtn).getByText("COPIED")).toBeTruthy(); // done === true branch
      act(() => { vi.advanceTimersByTime(1600); });
      expect(within(copyBtn).getByText("COPY")).toBeTruthy();   // reverted
    } finally { vi.runOnlyPendingTimers(); vi.useRealTimers(); }
  });

  it("swallows a clipboard rejection without flipping to COPIED", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<UsernameResultsDashboard data={resp()} />);
    const copyBtn = screen.getByRole("button", { name: /copy maigret neo/i });
    await act(async () => { fireEvent.click(copyBtn); });
    expect(within(copyBtn).getByText("COPY")).toBeTruthy(); // stayed on COPY
  });

  it("uses singular 'account' wording and no rich-profile clause for a lone hit", () => {
    const { container } = render(<UsernameResultsDashboard data={resp({
      found: 1, profiles: [], manual: 0,
      hits: [hit("github.com", "found")],
      identity: { names: [], locations: [], avatars: [], bios: [] },
    })} />);
    expect(container.textContent).toContain("1 confirmed account");
    expect(container.textContent).not.toContain("confirmed accounts");
    expect(screen.queryByText(/rich profile/)).toBeNull();
    expect(screen.queryByText(/to verify manually/)).toBeNull();
    expect(screen.queryByText(/IDENTITY SIGNALS/)).toBeNull(); // no identity block
  });

  it("shows the empty-state note when nothing is confirmed", () => {
    render(<UsernameResultsDashboard data={resp({
      found: 0, checked: 0, profiles: [], manual: 0,
      hits: [hit("dead.site", "notfound")],
      identity: { names: [], locations: [], avatars: [], bios: [] },
    })} />);
    expect(screen.getByText(/No confirmed accounts/i)).toBeTruthy();
    expect(screen.getByText(/0\/0 sites · 0%/)).toBeTruthy(); // rate guards divide-by-zero
  });

  it("hides an avatar image when it fails to load", () => {
    // Avatars use alt="" (decorative), so they have no "img" role — query the DOM.
    const { container } = render(<UsernameResultsDashboard data={resp()} />);
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBeGreaterThan(0);
    // Fire on every image so both the decorative Avatar and the resolved-identity
    // avatar exercise their onError-hide handlers.
    imgs.forEach((img) => fireEvent.error(img));
    expect(container.querySelectorAll("img").length).toBeLessThan(imgs.length);
  });

  it("renders a profile using the handle when there is no display name and drops an unsafe avatar", () => {
    render(<UsernameResultsDashboard data={resp({
      profiles: [profile({ displayName: null, avatarUrl: "javascript:alert(1)", bio: null, location: null, extra: null, joinedYear: null, stats: [] })],
      identity: { names: [], locations: [], avatars: [], bios: [] },
    })} />);
    const verified = screen.getByText(/VERIFIED PROFILES/).closest("div")!.parentElement!;
    // handle used as the link label; unsafe avatar produced no <img>
    expect(within(verified).getByText("neo")).toBeTruthy();
    expect(verified.querySelectorAll("img")).toHaveLength(0);
  });

  it("falls back to a raw category label for an unknown category", () => {
    render(<UsernameResultsDashboard data={resp({
      profiles: [], found: 1, manual: 0,
      hits: [hit("weird.site", "found", "totally-unknown-cat")],
      identity: { names: [], locations: [], avatars: [], bios: [] },
    })} />);
    // the group heading and tally use the raw category string when meta is missing
    expect(screen.getAllByText(/totally-unknown-cat/i).length).toBeGreaterThan(0);
  });

  it("pluralises rich profiles and colours an unknown-category profile with the default", () => {
    render(<UsernameResultsDashboard data={resp({
      profiles: [profile({ platform: "GitHub" }), profile({ platform: "Weird", category: "no-such-cat" })],
      identity: { names: [], locations: [], avatars: [], bios: [] },
    })} />);
    expect(screen.getByText(/2 rich profiles/)).toBeTruthy(); // plural clause
    expect(screen.getByText(/VERIFIED PROFILES \(2\)/)).toBeTruthy();
    expect(screen.getByText("Weird")).toBeTruthy();            // ProfileCard for the unknown category renders (catColor fallback)
  });
});
