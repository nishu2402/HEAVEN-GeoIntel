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
import AddToCase from "@/components/shared/AddToCase";
import type { HistoryEntry, InvestigationCase } from "@/lib/types";

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

describe("<AddToCase> (pin an identifier to a case)", () => {
  type Call = { url: string; opts?: RequestInit };
  function stubCases(initial: Partial<InvestigationCase>[]) {
    const calls: Call[] = [];
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      calls.push({ url, opts });
      if (!opts || opts.method === undefined) {
        return { ok: true, json: async () => ({ cases: initial }) } as unknown as Response; // GET list
      }
      const body = JSON.parse(String(opts.body));
      if (body.action === "create") {
        return { ok: true, json: async () => ({ case: { id: "new1", name: body.name, entities: [] } }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ case: { id: body.id, name: "x", entities: [{ kind: body.kind, value: body.value, addedAt: 1 }] } }) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return { calls };
  }
  const bodyActions = (calls: Call[]) => calls.filter((c) => c.opts?.body).map((c) => JSON.parse(String(c.opts!.body)));

  afterEach(() => vi.unstubAllGlobals());

  it("lazily lists cases and pins the primary identifier to the chosen one", async () => {
    const { calls } = stubCases([{ id: "c1", name: "Op Alpha", entities: [] }]);
    render(<AddToCase entities={[{ kind: "ip", value: "8.8.8.8" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /op alpha/i }));
    await screen.findByRole("button", { name: /pinned/i });
    expect(bodyActions(calls)).toContainEqual({ action: "addEntity", id: "c1", kind: "ip", value: "8.8.8.8" });
  });

  it("creates a new case then pins to it", async () => {
    const { calls } = stubCases([]);
    render(<AddToCase entities={[{ kind: "email", value: "a@b.com" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    await screen.findByText(/no cases yet/i);
    fireEvent.change(screen.getByLabelText(/new case name/i), { target: { value: "Fresh Case" } });
    fireEvent.click(screen.getByRole("button", { name: /create case and pin/i }));
    await screen.findByRole("button", { name: /pinned/i });
    expect(bodyActions(calls).map((b) => b.action)).toEqual(["create", "addEntity"]);
  });

  it("pins only the primary by default, but all entities when 'also pin related' is checked", async () => {
    const entities = [
      { kind: "domain" as const, value: "dns.google" },
      { kind: "ip" as const, value: "8.8.8.8" },
      { kind: "ip" as const, value: "8.8.4.4" },
    ];
    // default: primary only
    const first = stubCases([{ id: "c1", name: "Op Alpha", entities: [] }]);
    const { unmount } = render(<AddToCase entities={entities} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /op alpha/i }));
    await screen.findByRole("button", { name: /pinned/i });
    expect(bodyActions(first.calls).filter((b) => b.action === "addEntity").map((b) => b.value)).toEqual(["dns.google"]);
    unmount();

    // opt in: primary + related, in order
    const second = stubCases([{ id: "c1", name: "Op Alpha", entities: [] }]);
    render(<AddToCase entities={entities} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    fireEvent.click(await screen.findByLabelText(/also pin/i));
    fireEvent.click(await screen.findByRole("menuitem", { name: /op alpha/i }));
    await screen.findByRole("button", { name: /pinned/i });
    expect(bodyActions(second.calls).filter((b) => b.action === "addEntity").map((b) => b.value))
      .toEqual(["dns.google", "8.8.8.8", "8.8.4.4"]);
  });
});
