// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { installMemoryLocalStorage } from "./testUtils";

import HistorySidebar, { saveToHistory } from "@/components/dashboard/HistorySidebar";
import AddToCase from "@/components/shared/AddToCase";
import type { HistoryEntry } from "@/lib/types";

// Completes coverage for the two localStorage/fetch-backed components: HistorySidebar's
// read/save resilience + relative-time buckets + collapse/select, and AddToCase's
// reopen/error/timeout/edge paths.

beforeAll(() => { installMemoryLocalStorage(); });
beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

const HKEY = "heaven-geointel-history";
const entryAt = (e164: string, ageMs: number): HistoryEntry => ({
  e164, country: "US", countryCallingCode: "+1", timestamp: Date.now() - ageMs, flagEmoji: "🇺🇸",
} as HistoryEntry);

describe("<HistorySidebar> resilience + rendering", () => {
  it("renders nothing on the server (getServerSnapshot=EMPTY)", () => {
    expect(renderToStaticMarkup(<HistorySidebar onSelect={() => {}} />)).toBe("");
  });

  it("treats an unreadable localStorage (getItem throws) as empty history", () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
    const throwing = { ...localStorage, getItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    Object.defineProperty(globalThis, "localStorage", { value: throwing, configurable: true });
    try {
      const { container } = render(<HistorySidebar onSelect={() => {}} />);
      expect(container.textContent).toBe("");
    } finally {
      Object.defineProperty(globalThis, "localStorage", orig);
    }
  });

  it("treats a corrupt or non-array history blob as empty", () => {
    localStorage.setItem(HKEY, "{not valid json");
    const { container, unmount } = render(<HistorySidebar onSelect={() => {}} />);
    expect(container.textContent).toBe("");
    unmount();
    localStorage.setItem(HKEY, '{"nope":true}'); // valid JSON, not an array
    const { container: c2 } = render(<HistorySidebar onSelect={() => {}} />);
    expect(c2.textContent).toBe("");
  });

  it("saves through corrupt / non-array / array existing blobs, deduping by e164", () => {
    localStorage.setItem(HKEY, "broken");            // unparseable → start fresh (catch)
    act(() => saveToHistory(entryAt("+14155550001", 0)));
    localStorage.setItem(HKEY, '{"nope":true}');     // valid JSON, not an array → start fresh
    act(() => saveToHistory(entryAt("+14155550002", 0)));
    act(() => saveToHistory(entryAt("+14155550001", 0))); // array existing → dedupe to top
    const stored = JSON.parse(localStorage.getItem(HKEY)!) as HistoryEntry[];
    expect(stored.filter((e) => e.e164 === "+14155550001")).toHaveLength(1);
    expect(stored[0].e164).toBe("+14155550001");
  });

  it("shows every relative-time bucket, highlights the current number, collapses, and selects", () => {
    localStorage.setItem(HKEY, JSON.stringify([
      entryAt("+1s", 5_000),            // seconds
      entryAt("+1m", 5 * 60_000),       // minutes
      entryAt("+1h", 2 * 3_600_000),    // hours
      entryAt("+1d", 3 * 86_400_000),   // days
    ]));
    const onSelect = vi.fn();
    render(<HistorySidebar onSelect={onSelect} currentE164="+1m" />);
    expect(screen.getByText(/5s ago/)).toBeTruthy();
    expect(screen.getByText(/5m ago/)).toBeTruthy();
    expect(screen.getByText(/2h ago/)).toBeTruthy();
    expect(screen.getByText(/3d ago/)).toBeTruthy();
    // the current number's row is highlighted
    expect(screen.getByText("+1m").closest("button")!.className).toMatch(/bg-\[#00ff41\]\/10/);

    // select a row
    fireEvent.click(screen.getByText("+1s"));
    expect(onSelect).toHaveBeenCalledWith("+1s");

    // collapse the panel: the chevron flips from down (open) to right (closed).
    // (framer-motion keeps the body mounted through its exit animation, so assert
    // on the immediate open-state indicator rather than content removal.)
    const { container } = render(<HistorySidebar onSelect={() => {}} />);
    expect(container.querySelector(".lucide-chevron-down")).toBeTruthy();
    fireEvent.click(within(container).getByText(/recent queries/i));
    expect(container.querySelector(".lucide-chevron-right")).toBeTruthy();
  });

  it("clears history from the clear button", () => {
    localStorage.setItem(HKEY, JSON.stringify([entryAt("+1x", 1000)]));
    render(<HistorySidebar onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /clear history/i }));
    expect(localStorage.getItem(HKEY)).toBeNull();
    expect(screen.queryByText(/recent queries/i)).toBeNull();
  });
});

describe("<AddToCase> edge paths", () => {
  type Handler = (url: string, opts?: RequestInit) => Promise<Response>;
  const jsonRes = (body: unknown): Response => ({ ok: true, json: async () => body } as unknown as Response);
  const stub = (h: Handler) => vi.stubGlobal("fetch", vi.fn(h));
  afterEach(() => vi.unstubAllGlobals());

  it("caches the case list (no second GET on reopen) and closes via the click-catcher", async () => {
    let gets = 0;
    stub(async (_url, opts) => {
      if (!opts || opts.method === undefined) { gets++; return jsonRes({ cases: [{ id: "c1", name: "Alpha", entities: [] }] }); }
      return jsonRes({ case: { id: "c1", name: "Alpha", entities: [] } });
    });
    render(<AddToCase entities={[{ kind: "ip", value: "8.8.8.8" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    await screen.findByRole("menuitem", { name: /alpha/i });
    // close via the invisible click-catcher, then reopen — the list is cached
    fireEvent.click(document.querySelector('button[aria-hidden="true"]')!);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    await screen.findByRole("menuitem", { name: /alpha/i });
    expect(gets).toBe(1);
    // toggling the trigger again closes the menu without another fetch
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    expect(screen.queryByRole("menuitem", { name: /alpha/i })).toBeNull();
    expect(gets).toBe(1);
  });

  it("falls back to an empty list when the GET fails or omits cases", async () => {
    stub(async () => { throw new Error("network down"); });
    const { unmount } = render(<AddToCase entities={[{ kind: "ip", value: "8.8.8.8" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    expect(await screen.findByText(/no cases yet/i)).toBeTruthy();
    unmount();

    stub(async () => jsonRes({})); // 200 but no `cases` field → ?? []
    render(<AddToCase entities={[{ kind: "ip", value: "8.8.8.8" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    expect(await screen.findByText(/no cases yet/i)).toBeTruthy();
  });

  it("ignores an empty new-case name (Enter) and a non-Enter keydown", async () => {
    const posts: unknown[] = [];
    stub(async (_url, opts) => {
      if (!opts || opts.method === undefined) return jsonRes({ cases: [] });
      posts.push(JSON.parse(String(opts.body))); return jsonRes({ case: { id: "x", name: "x", entities: [] } });
    });
    render(<AddToCase entities={[{ kind: "ip", value: "8.8.8.8" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    const input = await screen.findByLabelText(/new case name/i);
    fireEvent.keyDown(input, { key: "a" });       // non-Enter → no-op
    fireEvent.keyDown(input, { key: "Enter" });    // empty name → guarded no-op
    expect(posts).toHaveLength(0);
  });

  it("reverts the PINNED confirmation after the timeout", async () => {
    vi.useFakeTimers();
    stub(async (_url, opts) => {
      if (!opts || opts.method === undefined) return jsonRes({ cases: [{ id: "c1", name: "Alpha", entities: [] }] });
      return jsonRes({ case: { id: "c1", name: "Alpha", entities: [] } });
    });
    render(<AddToCase entities={[{ kind: "ip", value: "8.8.8.8" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    // findBy* uses timers; advance them manually while awaiting
    await vi.waitFor(() => screen.getByRole("menuitem", { name: /alpha/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /alpha/i }));
    await vi.waitFor(() => screen.getByRole("button", { name: /pinned/i }));
    act(() => { vi.advanceTimersByTime(2600); });
    expect(screen.getByRole("button", { name: /add to case/i })).toBeTruthy();
    vi.useRealTimers();
  });

  it("creates a case while the list is still loading (prev === null branch)", async () => {
    let resolveGet: (r: Response) => void = () => {};
    stub(async (_url, opts) => {
      if (!opts || opts.method === undefined) return new Promise<Response>((r) => { resolveGet = r; }); // never resolves in time
      return jsonRes({ case: { id: "new", name: "Fresh", entities: [] } });
    });
    render(<AddToCase entities={[{ kind: "ip", value: "8.8.8.8" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    // cases is still null (GET pending) — create anyway
    const input = await screen.findByLabelText(/new case name/i);
    fireEvent.change(input, { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: /create case and pin/i }));
    await screen.findByRole("button", { name: /pinned/i });
    resolveGet(jsonRes({ cases: [] })); // let the dangling GET settle
  });

  it("does nothing when case creation returns an error (no case)", async () => {
    stub(async (_url, opts) => {
      if (!opts || opts.method === undefined) return jsonRes({ cases: [] });
      return jsonRes({ error: "boom" }); // create → no `case`
    });
    render(<AddToCase entities={[{ kind: "ip", value: "8.8.8.8" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    const input = await screen.findByLabelText(/new case name/i);
    fireEvent.change(input, { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: /create case and pin/i }));
    // stays open, no PINNED confirmation
    await screen.findByLabelText(/new case name/i);
    expect(screen.queryByRole("button", { name: /pinned/i })).toBeNull();
  });
});
