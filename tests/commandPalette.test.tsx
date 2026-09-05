// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { installMemoryLocalStorage, installResizeObserver } from "./testUtils";
import CommandPalette from "@/components/shared/CommandPalette";
import { ThemeProvider } from "@/components/shared/ThemeProvider";

// Completes CommandPalette coverage: the ⌘K/Ctrl+K global shortcut, the
// ignored-key branches, the backdrop-click close, and running the theme toggle
// (which also exercises the dark/light icon + label ternaries).

beforeAll(() => { installMemoryLocalStorage(); installResizeObserver(); });
beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute("data-theme"); });
afterEach(cleanup);

const renderPalette = () => {
  const onMode = vi.fn();
  const onQuickLookup = vi.fn();
  render(<ThemeProvider><CommandPalette onMode={onMode} onQuickLookup={onQuickLookup} /></ThemeProvider>);
  return { onMode, onQuickLookup };
};

describe("<CommandPalette> keyboard + backdrop", () => {
  it("toggles with ⌘K / Ctrl+K and ignores unrelated keys", () => {
    renderPalette();
    fireEvent.keyDown(document, { key: "k", metaKey: true });      // open
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "k", metaKey: true });      // toggle closed
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });      // Ctrl+K opens (|| right side)
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "j", metaKey: true });      // modifier + non-k → ignored
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "a" });                      // plain key → ignored
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });                 // Escape closes
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the backdrop overlay is clicked", () => {
    renderPalette();
    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }));
    const overlay = document.querySelector("div.fixed.inset-0") as HTMLElement;
    fireEvent.click(overlay);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("<CommandPalette> switch-mode labels", () => {
  it("shows the IP mode as 'IP', never title-cased to 'Ip'", () => {
    renderPalette();
    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }));
    // The acronym must stay whole in the proper-case "Switch mode" list.
    expect(screen.getByText("IP")).toBeTruthy();
    expect(screen.queryByText("Ip")).toBeNull();
    // An ordinary word label still reads as proper case.
    expect(screen.getByText("Phone")).toBeTruthy();
  });
});

describe("<CommandPalette> theme toggle item", () => {
  it("runs the theme toggle and reflects the new theme's label on reopen", () => {
    renderPalette();
    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }));
    // dark default → offers to switch to light
    fireEvent.click(screen.getByText(/switch to light theme/i));   // run(toggle) → light, closes
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    // reopen → now offers to switch back to dark (Moon icon branch)
    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }));
    expect(screen.getByText(/switch to dark theme/i)).toBeTruthy();
  });
});
