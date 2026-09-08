// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import UpdateBanner from "@/components/shared/UpdateBanner";
import UpdateChecker from "@/components/shared/UpdateChecker";
import { resetUpdateStoreForTests } from "@/lib/update/updateStore";
import { APP_VERSION } from "@/lib/version";
import type { UpdateInfo } from "@/lib/update/semver";

// The top banner is driven by the same shared check as the header button, so
// these tests assert two things: it reflects that check faithfully (a bar only
// for a real, tagged newer release), and it is a good citizen about dismissal —
// remembered per version, resilient to a blocked store, and firing no second
// request when it mounts alongside the header control.

// Keep in step with DISMISS_KEY in UpdateBanner.tsx.
const DISMISS_KEY = "hv:update-dismissed:v1";

const info = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({
  current: APP_VERSION,
  latest: "v99.0.0",
  updateAvailable: true,
  url: "https://github.com/nishu2402/HEAVEN-GeoIntel/releases/tag/v99.0.0",
  publishedAt: "2099-01-02T03:04:05Z",
  checkedAt: Date.now(),
  ok: true,
  ...over,
});

const okRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

let calls: string[];
function stubFetch(body: UpdateInfo) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => {
    calls.push(String(u));
    return okRes(body);
  }));
}

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const bar = () => screen.queryByRole("status");

beforeEach(() => { localStorage.clear(); resetUpdateStoreForTests(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); resetUpdateStoreForTests(); });

describe("<UpdateBanner>", () => {
  it("shows a full-width bar with the version and a release link for a newer release", async () => {
    stubFetch(info());
    render(<UpdateBanner />);
    await flush();
    expect(bar()).toBeTruthy();
    expect(screen.getByText(/a new version/i)).toBeTruthy();
    expect(screen.getByText("v99.0.0")).toBeTruthy();
    const link = screen.getByRole("link", { name: /view release notes/i }) as HTMLAnchorElement;
    expect(link.href).toContain("/releases/tag/v99.0.0");
  });

  it("renders nothing when the running build is already current", async () => {
    stubFetch(info({ updateAvailable: false, latest: `v${APP_VERSION}` }));
    render(<UpdateBanner />);
    await flush();
    expect(bar()).toBeNull();
  });

  it("renders nothing when the check could not reach GitHub", async () => {
    stubFetch(info({ ok: false, latest: null, updateAvailable: false, reason: "offline" }));
    render(<UpdateBanner />);
    await flush();
    expect(bar()).toBeNull();
  });

  it("refuses a version-less payload (never a blank update)", async () => {
    // updateAvailable true but no tag: the endpoint never emits this, but a
    // tampered or future-broken cache could, and the bar must stay silent.
    stubFetch(info({ latest: null }));
    render(<UpdateBanner />);
    await flush();
    expect(bar()).toBeNull();
  });

  it("dismisses the bar and remembers the version", async () => {
    stubFetch(info());
    render(<UpdateBanner />);
    await flush();
    expect(bar()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /dismiss update notice/i }));
    expect(bar()).toBeNull();
    expect(localStorage.getItem(DISMISS_KEY)).toBe("v99.0.0");
  });

  it("keeps the bar dismissed across a reload (a fresh mount)", async () => {
    // Dismiss, then simulate a full page reload: the component unmounts and the
    // in-memory store is rebuilt from scratch, but localStorage survives — as it
    // does across a real refresh. The bar must not come back for the same version.
    stubFetch(info());
    render(<UpdateBanner />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /dismiss update notice/i }));
    expect(bar()).toBeNull();
    expect(localStorage.getItem(DISMISS_KEY)).toBe("v99.0.0");

    // reload: tear down the tree and the run-once store latch, keep localStorage
    cleanup();
    resetUpdateStoreForTests();

    stubFetch(info()); // the same newer release is still what /api/version reports
    render(<UpdateBanner />);
    await flush();
    expect(bar()).toBeNull(); // remembered
  });

  it("stays hidden for a version already dismissed", async () => {
    localStorage.setItem(DISMISS_KEY, "v99.0.0");
    stubFetch(info());
    render(<UpdateBanner />);
    await flush();
    expect(bar()).toBeNull();
  });

  it("still shows after dismissing an older version, then returns for the newer one", async () => {
    localStorage.setItem(DISMISS_KEY, "v1.0.0"); // dismissed a prior release
    stubFetch(info()); // latest is v99.0.0 — a newer one than was dismissed
    render(<UpdateBanner />);
    await flush();
    expect(bar()).toBeTruthy();
  });

  it("still closes when the store cannot be written", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    stubFetch(info());
    render(<UpdateBanner />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /dismiss update notice/i }));
    expect(bar()).toBeNull();
    spy.mockRestore();
  });

  it("reads through a blocked store and still shows the bar", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    stubFetch(info());
    render(<UpdateBanner />);
    await flush();
    expect(bar()).toBeTruthy();
    spy.mockRestore();
  });

  it("shares one check with the header button, firing no second request", async () => {
    stubFetch(info());
    render(<><UpdateChecker /><UpdateBanner /></>);
    await flush();
    // one bootstrap for the whole page, not one per consumer
    expect(calls).toEqual(["/api/version"]);
    // both surfaces reflect the same answer
    expect(bar()).toBeTruthy();
    expect(screen.getByRole("button", { name: /update available/i })).toBeTruthy();
  });
});
