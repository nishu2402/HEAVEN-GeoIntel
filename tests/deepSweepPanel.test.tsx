// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import DeepSweepPanel from "@/components/username/DeepSweepPanel";
import type { SweepHit, UsernameSweepResponse } from "@/lib/types";

// The deep sweep is a minute of real traffic across hundreds of sites, so the
// panel has to stay honest about three things: only a site's own presence
// marker counts as an account, a site that could not be checked is a gap in
// coverage rather than an absence, and the analyst can stop it mid-run.

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const hit = (over: Partial<SweepHit> = {}): SweepHit => ({
  site: "GitHub", category: "coding", url: "https://github.com/jdoe", status: "found", ...over,
});

const page = (over: Partial<UsernameSweepResponse> = {}): UsernameSweepResponse => ({
  username: "jdoe", offset: 0, limit: 50, total: 50, unvalidated: 0,
  nextOffset: null, hits: [], found: 0, notfound: 0, unknown: 0, ...over,
});

const start = () => act(async () => { fireEvent.click(screen.getByRole("button", { name: /Start|Run again/ })); });

describe("<DeepSweepPanel> before it runs", () => {
  it("offers a start and claims no coverage yet", () => {
    render(<DeepSweepPanel username="jdoe" fetchPage={async () => page()} />);
    expect(screen.getByRole("button", { name: /Start/ })).toBeTruthy();
    expect(screen.queryByText(/sites$/)).toBeNull();
    expect(screen.getByText(/counted as unchecked, never as absent/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "WhatsMyName" })).toBeTruthy();
  });
});

describe("<DeepSweepPanel> running", () => {
  it("lists only accounts the site's own marker confirmed", async () => {
    // notfound and unknown both mean "no confirmed account"; showing either as a
    // hit is the false positive this sweep is built to avoid.
    render(<DeepSweepPanel username="jdoe" fetchPage={async () => page({
      hits: [hit(), hit({ site: "Reddit", status: "notfound" }), hit({ site: "Quora", status: "unknown" })],
      found: 1, notfound: 1, unknown: 1,
    })} />);
    await start();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.queryByText("Reddit")).toBeNull();
    expect(screen.queryByText("Quora")).toBeNull();
    expect(screen.getByRole("link", { name: /GitHub/ }).getAttribute("href")).toBe("https://github.com/jdoe");
    expect(screen.getByText("coding")).toBeTruthy();
  });

  it("walks every page and shows progress against the total", async () => {
    const pages = [
      page({ offset: 0, limit: 50, total: 100, nextOffset: 50, hits: [hit()] }),
      page({ offset: 50, limit: 50, total: 100, nextOffset: null, hits: [hit({ site: "Reddit", url: "https://reddit.com/u/jdoe" })] }),
    ];
    let n = 0;
    render(<DeepSweepPanel username="jdoe" fetchPage={async () => pages[n++]} />);
    await start();
    expect(n).toBe(2);
    expect(screen.getByText(/DEEP SWEEP: 100\/100 sites/)).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Reddit")).toBeTruthy();
  });

  it("says plainly when nothing was confirmed anywhere", async () => {
    render(<DeepSweepPanel username="jdoe" fetchPage={async () => page({ total: 40, limit: 40 })} />);
    await start();
    expect(screen.getByText("No confirmed account on the 40 sites checked.")).toBeTruthy();
  });

  it("offers a re-run once a sweep has finished", async () => {
    render(<DeepSweepPanel username="jdoe" fetchPage={async () => page()} />);
    await start();
    expect(screen.getByRole("button", { name: /Run again/ })).toBeTruthy();
  });

  it("stops when asked and keeps what it already found", async () => {
    // Never-ending pages: only the Stop button can end this.
    const fetchPage = vi.fn(async (_u: string, offset: number) =>
      page({ offset, limit: 10, total: 1000, nextOffset: offset + 10, hits: [hit({ site: `S${offset}`, url: `https://x/${offset}` })] }));
    render(<DeepSweepPanel username="jdoe" fetchPage={fetchPage} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start/ }));
      await Promise.resolve();
      fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /Run again/ })).toBeTruthy());
    const calls = fetchPage.mock.calls.length;
    // A stopped sweep is incomplete, not empty, and it does not keep paging.
    expect(screen.getByText(/DEEP SWEEP:/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchPage.mock.calls.length).toBe(calls);
  });

  it("reports a failed request instead of an empty result", async () => {
    render(<DeepSweepPanel username="jdoe" fetchPage={async () => { throw new Error("boom"); }} />);
    await start();
    expect(screen.getByText("the sweep request failed")).toBeTruthy();
    expect(screen.queryByText(/No confirmed account/)).toBeNull();
  });

  it("clears a previous run's hits when started again", async () => {
    let first = true;
    render(<DeepSweepPanel username="jdoe" fetchPage={async () => {
      if (first) { first = false; return page({ hits: [hit()], found: 1 }); }
      return page();
    }} />);
    await start();
    expect(screen.getByText("GitHub")).toBeTruthy();
    await start();
    expect(screen.queryByText("GitHub")).toBeNull();
  });
});

describe("<DeepSweepPanel> and sites whose markers failed validation", () => {
  it("offers them separately and counts them, rather than quietly narrowing coverage", async () => {
    const fetchPage = vi.fn<(u: string, offset: number, includeUnvalidated?: boolean) => Promise<UsernameSweepResponse>>(
      async () => page({ unvalidated: 7 }),
    );
    render(<DeepSweepPanel username="jdoe" fetchPage={fetchPage} />);
    await start();
    const extra = screen.getByRole("button", { name: /also check the 7 sites/ });
    expect(extra).toBeTruthy();

    await act(async () => { fireEvent.click(extra); });
    // The second pass asks for them explicitly.
    expect(fetchPage.mock.calls[0][2]).toBe(false);
    expect(fetchPage.mock.calls[1][2]).toBe(true);
    expect(screen.getByRole("button", { name: /re-run the 7 sites/ })).toBeTruthy();
  });

  it("says nothing about them when every site passed validation", async () => {
    render(<DeepSweepPanel username="jdoe" fetchPage={async () => page({ unvalidated: 0 })} />);
    await start();
    expect(screen.queryByRole("button", { name: /sites whose detection markers/ })).toBeNull();
  });
});

describe("<DeepSweepPanel> talking to the endpoint", () => {
  it("posts the handle, the page offset and the validation choice", async () => {
    const fetchMock = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => ({ ok: true, status: 200, json: async () => page({ hits: [hit()], found: 1 }) }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DeepSweepPanel username="jdoe" />);
    await start();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/username-sweep");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body)))
      .toEqual({ username: "jdoe", offset: 0, includeUnvalidated: false });
    expect(screen.getByText("GitHub")).toBeTruthy();
  });

  it("surfaces a refused sweep rather than reporting no accounts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response));
    render(<DeepSweepPanel username="jdoe" />);
    await start();
    expect(screen.getByText("the sweep request failed")).toBeTruthy();
  });
});
