// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import UpdateChecker from "@/components/shared/UpdateChecker";
import { resetUpdateStoreForTests } from "@/lib/update/updateStore";
import { APP_VERSION } from "@/lib/version";
import type { UpdateInfo } from "@/lib/update/semver";

// The header badge reflects exactly what /api/version returns and nothing more:
// an amber dot only for a real newer release, a plain "could not check" for any
// failure, and a persistent-but-refreshable cache in localStorage. These tests
// drive every state, including the storage corners (fresh hydrate, stale, junk,
// unwritable) that decide whether the badge is honest across reloads.

// Keep in step with CACHE_KEY in updateStore.ts.
const CACHE_KEY = "hv:update:v1";

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
function stubFetch(body: UpdateInfo | (() => Promise<Response>)) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => {
    calls.push(String(u));
    return typeof body === "function" ? body() : okRes(body);
  }));
}

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /software updates|update available/i }));

// The check is a shared module-level store; reset it so one case's result and
// its run-once latch never leak into the next.
beforeEach(() => { localStorage.clear(); resetUpdateStoreForTests(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); resetUpdateStoreForTests(); });

describe("<UpdateChecker>", () => {
  it("auto-checks on mount and flags a newer release with a link", async () => {
    stubFetch(info());
    render(<UpdateChecker />);
    await flush();
    // the trigger advertises the update, and the amber dot is present
    expect(screen.getByRole("button", { name: /update available/i })).toBeTruthy();
    expect(calls).toEqual(["/api/version"]);

    openPanel();
    expect(screen.getByText(/a newer version is available, published 2099-01-02/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /view the release notes/i }) as HTMLAnchorElement;
    expect(link.href).toContain("/releases/tag/v99.0.0");
  });

  it("shows an update with no published date when GitHub omits it", async () => {
    stubFetch(info({ publishedAt: null }));
    render(<UpdateChecker />);
    await flush();
    openPanel();
    expect(screen.getByText(/a newer version is available\./i)).toBeTruthy();
  });

  it("reports up to date when the running build is current", async () => {
    stubFetch(info({ updateAvailable: false, latest: `v${APP_VERSION}` }));
    render(<UpdateChecker />);
    await flush();
    // no update: neutral trigger, no dot
    expect(screen.getByRole("button", { name: /software updates/i })).toBeTruthy();
    openPanel();
    expect(screen.getByText(/you are on the latest version/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(`v${APP_VERSION.replace(/\./g, "\\.")}`))).toBeTruthy();
  });

  it("shows a 'could not check' reason when the endpoint could not reach GitHub", async () => {
    stubFetch(info({ ok: false, latest: null, updateAvailable: false, reason: "not found" }));
    render(<UpdateChecker />);
    await flush();
    openPanel();
    expect(screen.getByText(/could not check for updates \(not found\)/i)).toBeTruthy();
  });

  it("shows a bare 'could not check' when no reason is supplied", async () => {
    stubFetch(info({ ok: false, latest: null, updateAvailable: false, reason: undefined }));
    render(<UpdateChecker />);
    await flush();
    openPanel();
    expect(screen.getByText(/could not check for updates\. the running build is unaffected/i)).toBeTruthy();
  });

  it("hydrates from a fresh cached answer without hitting the endpoint", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), info: info() }));
    stubFetch(info());
    render(<UpdateChecker />);
    await flush();
    expect(screen.getByRole("button", { name: /update available/i })).toBeTruthy();
    expect(calls).toEqual([]); // fresh cache → no network
  });

  it("re-checks when the cached answer is stale", async () => {
    const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: sevenHoursAgo, info: info() }));
    stubFetch(info());
    render(<UpdateChecker />);
    await flush();
    expect(calls).toEqual(["/api/version"]); // stale cache → one refresh
  });

  it("ignores unparseable or malformed cached data and checks anyway", async () => {
    localStorage.setItem(CACHE_KEY, "not json at all");
    stubFetch(info());
    render(<UpdateChecker />);
    await flush();
    expect(calls).toEqual(["/api/version"]);
    cleanup();
    resetUpdateStoreForTests(); // second render is a fresh page: clear the run-once latch

    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: "wrong-type" })); // valid JSON, wrong shape
    stubFetch(info());
    render(<UpdateChecker />);
    await flush();
    expect(calls).toEqual(["/api/version"]);
  });

  it("checks anyway when localStorage cannot be read", async () => {
    // A store that throws on read (some privacy modes) must fall through to a
    // network check rather than crashing the bootstrap.
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    stubFetch(info());
    render(<UpdateChecker />);
    await flush();
    expect(calls).toEqual(["/api/version"]);
    spy.mockRestore();
  });

  it("still renders when localStorage cannot be written", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    stubFetch(info({ updateAvailable: false, latest: `v${APP_VERSION}` }));
    render(<UpdateChecker />);
    await flush();
    openPanel();
    expect(screen.getByText(/you are on the latest version/i)).toBeTruthy();
    spy.mockRestore();
  });

  it("surfaces a transport failure to the app", async () => {
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    render(<UpdateChecker />);
    await flush();
    openPanel();
    expect(screen.getByText(/could not reach this instance to check for updates/i)).toBeTruthy();
  });

  it("shows a checking state while the first check is in flight", async () => {
    let release: (r: Response) => void = () => {};
    const pending = new Promise<Response>((r) => { release = r; });
    stubFetch(() => pending);
    render(<UpdateChecker />);
    openPanel();
    expect(screen.getByText(/checking for updates…/i)).toBeTruthy();
    await act(async () => { release(okRes(info())); await Promise.resolve(); });
  });

  it("forces a fresh check from the popover button", async () => {
    // fresh cache → no auto fetch, so the only call is the manual one
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), info: info({ updateAvailable: false, latest: `v${APP_VERSION}` }) }));
    stubFetch(info({ updateAvailable: false, latest: `v${APP_VERSION}` }));
    render(<UpdateChecker />);
    await flush();
    openPanel();
    expect(calls).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^check for updates$/i })); await Promise.resolve(); await Promise.resolve(); });
    expect(calls).toEqual(["/api/version?force=1"]);
  });

  it("closes on the X and on the backdrop", async () => {
    stubFetch(info({ updateAvailable: false, latest: `v${APP_VERSION}` }));
    render(<UpdateChecker />);
    await flush();
    openPanel();
    expect(screen.getByText(/software update/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByText(/you are on the latest version/i)).toBeNull();

    openPanel();
    fireEvent.click(document.querySelector(".bg-black\\/75")!.parentElement!);
    expect(screen.queryByText(/you are on the latest version/i)).toBeNull();
  });
});
