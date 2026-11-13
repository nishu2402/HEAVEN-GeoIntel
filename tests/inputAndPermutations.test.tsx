// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import EmailInput from "@/components/email/EmailInput";
import NumberPermutations from "@/components/phone/NumberPermutations";
import type { LookupResponse } from "@/lib/types";

afterEach(cleanup);

describe("<EmailInput>", () => {
  it("moves through empty → invalid → valid and submits only when valid", () => {
    const onLookup = vi.fn();
    render(<EmailInput onLookup={onLookup} loading={false} />);
    expect(screen.getByText(/enter an email address/i)).toBeTruthy();

    const input = screen.getByPlaceholderText(/target@domain\.com/i);
    fireEvent.change(input, { target: { value: "not-an-email" } });
    expect(screen.getByText(/not a valid email address/i)).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });            // invalid → ignored
    expect(onLookup).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "  a@b.com  " } });
    expect(screen.getByText(/valid: will scan/i)).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });            // valid → trimmed submit
    expect(onLookup).toHaveBeenCalledWith("a@b.com");

    fireEvent.click(screen.getByRole("button", { name: /execute lookup/i }));
    expect(onLookup).toHaveBeenCalledTimes(2);
  });

  it("shows SCANNING + disables the button while loading", () => {
    render(<EmailInput onLookup={() => {}} loading />);
    const btn = screen.getByRole("button", { name: /scanning/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("shows the clear button when there is a value or an onClear, and clears", () => {
    const onClear = vi.fn();
    const { rerender } = render(<EmailInput onLookup={() => {}} loading={false} />);
    // no value + no onClear → no clear button
    expect(screen.queryByTitle("Clear")).toBeNull();
    const input = screen.getByPlaceholderText(/target@domain\.com/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x@y.com" } });
    fireEvent.click(screen.getByTitle("Clear"));
    expect(input.value).toBe("");

    rerender(<EmailInput onLookup={() => {}} onClear={onClear} loading={false} />);
    fireEvent.click(screen.getByTitle("Clear"));           // present via onClear even when empty
    expect(onClear).toHaveBeenCalled();
  });
});

describe("<NumberPermutations>", () => {
  const mk = (e164: string, cc: string, over: Record<string, unknown> = {}): LookupResponse => ({
    input: { e164, countryCallingCode: cc },
    aggregated: {
      formatInternational: e164, formatNational: e164, formatRfc3966: `tel:${e164}`, ...over,
    },
  } as unknown as LookupResponse);

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("renders the 10-digit dot/dash formats and copies a value (reverting after the timeout)", () => {
    render(<NumberPermutations data={mk("+14155551234", "+1")} />);
    expect(screen.getByText("415.555.1234")).toBeTruthy();   // 10-digit dot branch
    expect(screen.getByText("415-555-1234")).toBeTruthy();   // 10-digit dash branch
    expect(screen.getByText("https://wa.me/14155551234")).toBeTruthy();

    const copyBtns = screen.getAllByTitle("Copy");
    fireEvent.click(copyBtns[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("+14155551234");
    act(() => { vi.advanceTimersByTime(1500); });            // copied → reverts
  });

  it("falls back to the 7-digit dot/dash formats for a shorter subscriber number", () => {
    render(<NumberPermutations data={mk("+15551234", "+1")} />);
    expect(screen.getByText("555.1234")).toBeTruthy();       // 7-digit dot branch
    expect(screen.getByText("555-1234")).toBeTruthy();       // 7-digit dash branch
  });

  it("the Stripped-spaces row is a distinct value, not a copy of canonical E.164", () => {
    // With a real libphonenumber national format (spaces present), stripping its
    // spaces yields "(415)555-1234", which is NOT the spaceless canonical E.164.
    // getByText also asserts uniqueness, so both the spaced national row and the
    // stripped row are present and separate. A revert to `e164.replace(/\s/g,"")`
    // would make the stripped value equal canonical E.164, so "(415)555-1234"
    // would vanish and this test would fail: the dead-duplicate guard.
    render(<NumberPermutations data={mk("+14155551234", "+1", {
      formatInternational: "+1 415 555 1234",
      formatNational: "(415) 555-1234",
      formatRfc3966: "tel:+1-415-555-1234",
    })} />);
    expect(screen.getByText("(415) 555-1234")).toBeTruthy(); // national, spaces kept
    expect(screen.getByText("(415)555-1234")).toBeTruthy();  // stripped, distinct
    expect(screen.getByText("+14155551234")).toBeTruthy();   // canonical, separate
  });
});
