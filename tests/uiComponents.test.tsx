// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { installMemoryLocalStorage, installResizeObserver } from "./testUtils";

import ConsentGate from "@/components/shared/ConsentGate";
import EffectsToggle from "@/components/shared/EffectsToggle";
import { ThemeProvider } from "@/components/shared/ThemeProvider";
import ThemeToggle from "@/components/shared/ThemeToggle";
import HistorySidebar, { saveToHistory } from "@/components/dashboard/HistorySidebar";
import CommandPalette from "@/components/shared/CommandPalette";
import type { HistoryEntry } from "@/lib/types";

// Interaction tests for the client components — with a focus on locking in the
// useSyncExternalStore refactor of ConsentGate / ThemeProvider / EffectsToggle /
// HistorySidebar so a regression (e.g. dropping the change-event, or a stale
// snapshot) is caught. jsdom supplies window + events; localStorage is stubbed.

beforeAll(() => { installMemoryLocalStorage(); installResizeObserver(); });
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(cleanup);

describe("<ConsentGate> (localStorage store)", () => {
  it("shows the gate on first visit (no stored acceptance)", () => {
    render(<ConsentGate />);
    expect(screen.getByRole("dialog", { name: /permitted use/i })).toBeTruthy();
  });

  it("hides and persists acceptance on click, and stays hidden when already accepted", () => {
    const { unmount } = render(<ConsentGate />);
    fireEvent.click(screen.getByRole("button", { name: /i understand/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("hv-consent-v1")).toBe("1");

    unmount();
    render(<ConsentGate />); // fresh mount with acceptance already stored
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("<ThemeProvider> + <ThemeToggle> (DOM/localStorage store)", () => {
  it("defaults to dark, flips to light on toggle, and persists + reflects to <html>", () => {
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    const btn = screen.getByRole("button", { name: /switch to light theme/i });
    expect(btn).toBeTruthy(); // dark by default → offers to switch to light

    fireEvent.click(btn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("heaven-geointel-theme")).toBe("light");
    // Label now offers the reverse switch → the store re-read propagated.
    expect(screen.getByRole("button", { name: /switch to dark theme/i })).toBeTruthy();
  });
});

describe("<EffectsToggle> (localStorage store)", () => {
  it("starts on, turns off on click, and persists the choice", () => {
    render(<EffectsToggle />);
    const btn = screen.getByRole("button", { name: /turn off visual effects/i });
    fireEvent.click(btn);
    expect(localStorage.getItem("hv-fx")).toBe("0");
    expect(screen.getByRole("button", { name: /turn on visual effects/i })).toBeTruthy();
  });
});

describe("<HistorySidebar> (localStorage store)", () => {
  const entry: HistoryEntry = {
    e164: "+14155552671", country: "US", countryCallingCode: "+1",
    timestamp: Date.now(), flagEmoji: "🇺🇸",
  } as HistoryEntry;

  it("renders nothing when empty, then shows an entry saved via saveToHistory", () => {
    const { container } = render(<HistorySidebar onSelect={() => {}} />);
    expect(container.textContent).toBe(""); // returns null while history is empty

    // saveToHistory writes localStorage + dispatches the change event → the
    // subscribed store re-reads and the sidebar renders the entry live. The
    // store update happens outside React's event system, so flush it with act().
    act(() => saveToHistory(entry));
    expect(screen.getByText(/RECENT QUERIES/i)).toBeTruthy();
    expect(screen.getByText(/\+14155552671/)).toBeTruthy();
  });

  it("clears the list when CLEAR is pressed", () => {
    saveToHistory(entry);
    render(<HistorySidebar onSelect={() => {}} />);
    expect(screen.getByText(/RECENT QUERIES/i)).toBeTruthy();

    const clearBtn = screen.getByRole("button", { name: /clear history/i });
    fireEvent.click(clearBtn);
    expect(localStorage.getItem("heaven-geointel-history")).toBeNull();
    expect(screen.queryByText(/RECENT QUERIES/i)).toBeNull();
  });
});

describe("<CommandPalette> routing", () => {
  const renderPalette = () => {
    const onMode = vi.fn();
    const onQuickLookup = vi.fn();
    render(
      <ThemeProvider>
        <CommandPalette onMode={onMode} onQuickLookup={onQuickLookup} />
      </ThemeProvider>,
    );
    return { onMode, onQuickLookup };
  };

  it("opens from the trigger as a named modal dialog with the mode + appearance groups", () => {
    renderPalette();
    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }));
    // a11y: the panel is a named modal dialog (screen readers announce it).
    const dialog = screen.getByRole("dialog", { name: /command palette/i });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByPlaceholderText(/type a phone/i)).toBeTruthy();
    expect(screen.getByText(/switch to (light|dark) theme/i)).toBeTruthy();
  });

  it("returns focus to the trigger when closed with Escape", () => {
    renderPalette();
    const trigger = screen.getByRole("button", { name: /open command palette/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger); // focus restored for keyboard users
  });

  it("smart-runs a typed IP as an IP lookup", () => {
    const { onQuickLookup } = renderPalette();
    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }));
    const input = screen.getByPlaceholderText(/type a phone/i);
    fireEvent.change(input, { target: { value: "8.8.8.8" } });

    // The "Run lookup" item classifies 8.8.8.8 as IP (regression-guards the
    // detectMode ordering fix — a dotted IPv4 must not be read as a phone).
    const runItem = screen.getByText(/as IP$/i);
    fireEvent.click(runItem);
    expect(onQuickLookup).toHaveBeenCalledWith("ip", "8.8.8.8");
  });

  it("switches mode when a mode item is chosen", () => {
    const { onMode } = renderPalette();
    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }));
    const group = screen.getByText(/switch mode/i).closest("[cmdk-group]") as HTMLElement;
    fireEvent.click(within(group).getByText(/^email$/i));
    expect(onMode).toHaveBeenCalledWith("email");
  });
});
