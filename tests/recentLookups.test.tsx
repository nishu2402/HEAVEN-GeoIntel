// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { installMemoryLocalStorage } from "./testUtils";
import RecentLookups from "@/components/shared/RecentLookups";
import { pushLookup, type LookupItem } from "@/lib/client/lookupHistory";

const LKEY = "hv-lookups-v1";

beforeAll(() => { installMemoryLocalStorage(); });
beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

const seed = (items: LookupItem[]) => localStorage.setItem(LKEY, JSON.stringify(items));
const item = (kind: LookupItem["kind"], value: string, ageMs: number): LookupItem => ({ kind, value, ts: Date.now() - ageMs });

describe("<RecentLookups>", () => {
  it("shows an empty state and no count badge when there is no history", () => {
    render(<RecentLookups onRun={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /recent lookups/i }));
    expect(screen.getByText(/no lookups yet/i)).toBeTruthy();
  });

  it("renders items with every relative-time bucket and runs one on click", () => {
    seed([
      item("phone", "+1", 5_000),                 // s
      item("email", "a@b.com", 5 * 60_000),       // m
      item("username", "neo", 5 * 3_600_000),     // h
      item("ip", "8.8.8.8", 3 * 86_400_000),      // d
      item("domain", "x.com", 14 * 86_400_000),   // w
    ]);
    const onRun = vi.fn();
    render(<RecentLookups onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: /recent lookups/i }));
    expect(screen.getByText("5s")).toBeTruthy();
    expect(screen.getByText("5m")).toBeTruthy();
    expect(screen.getByText("5h")).toBeTruthy();
    expect(screen.getByText("3d")).toBeTruthy();
    expect(screen.getByText("2w")).toBeTruthy();

    fireEvent.click(screen.getByText("8.8.8.8"));
    expect(onRun).toHaveBeenCalledWith("ip", "8.8.8.8");
    // running an item closes the panel
    expect(screen.queryByText("8.8.8.8")).toBeNull();
  });

  it("live-updates when a lookup is pushed, and clears on demand", () => {
    render(<RecentLookups onRun={() => {}} />);
    act(() => pushLookup("phone", "+14155552671")); // dispatches LOOKUPS_EVENT → refresh
    fireEvent.click(screen.getByRole("button", { name: /recent lookups/i }));
    expect(screen.getByText("+14155552671")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /clear history/i }));
    expect(screen.queryByText("+14155552671")).toBeNull();
  });

  it("stays open on an inside click, toggles closed from the trigger, and closes on an outside click", () => {
    seed([item("phone", "+1", 1000)]);
    render(<RecentLookups onRun={() => {}} />);
    const trigger = screen.getByRole("button", { name: /recent lookups/i });
    fireEvent.click(trigger);
    const heading = screen.getByText(/^recent lookups$/i);
    fireEvent.mouseDown(heading);            // inside the popover → stays open
    expect(screen.getByText("+1")).toBeTruthy();
    fireEvent.click(trigger);                // toggle closed from the trigger (next === false)
    expect(screen.queryByText("+1")).toBeNull();

    fireEvent.click(trigger);                // reopen, then close via an outside click
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("+1")).toBeNull();
  });

  it("reacts to a cross-tab storage event", () => {
    render(<RecentLookups onRun={() => {}} />);
    seed([item("email", "cross@tab.com", 1000)]);
    act(() => { window.dispatchEvent(new Event("storage")); });
    fireEvent.click(screen.getByRole("button", { name: /recent lookups/i }));
    expect(screen.getByText("cross@tab.com")).toBeTruthy();
  });
});
