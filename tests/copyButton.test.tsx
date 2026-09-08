// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import CopyButton from "@/components/shared/CopyButton";

// The shared copy chip wraps copyText, which only touches navigator.clipboard in
// a secure context — stub both so the click path runs end to end.
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); cleanup(); });

describe("<CopyButton>", () => {
  it("labelled: derives 'Copy <label>' aria, copies, flips to COPIED, then reverts", () => {
    render(<CopyButton text="+14155552671" label="COPY E.164" />);
    const btn = screen.getByRole("button", { name: "Copy COPY E.164" });
    expect(btn.getAttribute("title")).toBe("Copy COPY E.164"); // aria doubles as tooltip
    expect(screen.getByText("COPY E.164")).toBeTruthy();        // label != null → span rendered

    act(() => { fireEvent.click(btn); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("+14155552671");
    expect(screen.getByText("COPIED")).toBeTruthy();            // done === true branch

    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText("COPY E.164")).toBeTruthy();        // reverted after the timeout
  });

  it("honours an explicit ariaLabel over the label-derived default", () => {
    render(<CopyButton text="8.8.8.8" ariaLabel="Copy IP address" />);
    const btn = screen.getByRole("button", { name: "Copy IP address" });
    expect(btn.getAttribute("title")).toBe("Copy IP address");
  });

  it("icon-only (no label): defaults the aria to 'Copy' and renders no text span", () => {
    render(<CopyButton text="abc" />);
    const btn = screen.getByRole("button", { name: "Copy" });
    expect(btn.textContent).toBe("");                           // label absent → span not rendered
    // default className is applied when none is passed
    expect(btn.className).toContain("hv-glass-border");
  });

  it("applies a custom className when provided", () => {
    render(<CopyButton text="x" ariaLabel="Copy custom" className="my-copy-chip" />);
    expect(screen.getByRole("button", { name: "Copy custom" }).className).toBe("my-copy-chip");
  });
});
