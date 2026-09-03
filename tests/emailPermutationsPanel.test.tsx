// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import EmailPermutations from "@/components/network/EmailPermutations";

// The panel copies to the clipboard; jsdom has no real one.
const writeText = vi.fn((text: string) => Promise.resolve(text));
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  // copyText only reaches navigator.clipboard in a secure context; without this
  // it silently takes the execCommand fallback and the spy never fires.
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  writeText.mockClear();
});
afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks(); });

const typeName = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("Jane Q. Doe"), { target: { value } });

describe("<EmailPermutations>", () => {
  it("shows nothing but the input until a name is entered", () => {
    render(<EmailPermutations domain="acme.com" />);
    expect(screen.getByText("EMAIL PERMUTATIONS")).toBeTruthy();
    expect(screen.queryByText(/Copy all/)).toBeNull();
    expect(screen.queryByText(/Candidates only/)).toBeNull();
  });

  it("generates candidates for the domain, most likely first", () => {
    render(<EmailPermutations domain="acme.com" />);
    typeName("John Smith");
    expect(screen.getByText("john.smith@acme.com")).toBeTruthy();
    expect(screen.getByText("jsmith@acme.com")).toBeTruthy();
    const rows = screen.getAllByTitle("Copy this address");
    expect(rows[0].textContent).toContain("john.smith@acme.com");
  });

  it("states plainly that the addresses are unverified", () => {
    render(<EmailPermutations domain="acme.com" />);
    typeName("John Smith");
    expect(screen.getByText(/Nothing here has been checked against the mail server/)).toBeTruthy();
  });

  it("copies a single address and confirms it", () => {
    render(<EmailPermutations domain="acme.com" />);
    typeName("John Smith");
    fireEvent.click(screen.getByText("john.smith@acme.com").closest("button")!);
    expect(writeText).toHaveBeenCalledWith("john.smith@acme.com");
  });

  it("copies every candidate as one newline-separated block", () => {
    render(<EmailPermutations domain="acme.com" />);
    typeName("John Smith");
    fireEvent.click(screen.getByText(/Copy all/));
    const copied = writeText.mock.calls[0][0];
    expect(copied.split("\n")[0]).toBe("john.smith@acme.com");
    expect(copied.split("\n").length).toBeGreaterThan(10);
  });

  it("clears the copied confirmation after the timeout", () => {
    render(<EmailPermutations domain="acme.com" />);
    typeName("John Smith");
    const btn = () => screen.getByText(/Copy all/).closest("button")!;
    fireEvent.click(btn());
    // The tick is an <svg>; assert on it rather than on the label, which never
    // changes and would make this test pass whatever the state did.
    expect(btn().querySelector("svg")!.getAttribute("class")).toContain("lucide-check");
    // The state updater only runs when React flushes, so the advance has to be
    // inside act() — without it the timeout fires and nothing re-renders.
    act(() => { vi.advanceTimersByTime(2000); });
    expect(btn().querySelector("svg")!.getAttribute("class")).toContain("lucide-copy");
  });

  it("keeps a second copy's confirmation when the first one's timer fires", () => {
    // The first row's timeout must not clear the SECOND row's tick — that is
    // what the `c === key` guard is for, and it only shows up when the timers
    // are staggered rather than fired together.
    render(<EmailPermutations domain="acme.com" />);
    typeName("John Smith");
    fireEvent.click(screen.getByText("john.smith@acme.com").closest("button")!);
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.click(screen.getByText("jsmith@acme.com").closest("button")!);
    act(() => { vi.advanceTimersByTime(1000); });   // FIRST timer fires; second still live
    expect(writeText).toHaveBeenCalledTimes(2);
    const second = screen.getByText("jsmith@acme.com").closest("button")!;
    expect(second.querySelector("svg")!.getAttribute("class")).toContain("lucide-check");
  });

  it("identifies the organisation's rule from one known address", () => {
    render(<EmailPermutations domain="acme.com" />);
    typeName("Jane Doe");
    fireEvent.change(screen.getByPlaceholderText("That person's full name"), { target: { value: "John Smith" } });
    fireEvent.change(screen.getByPlaceholderText("known.person@acme.com"), { target: { value: "j.smith@acme.com" } });
    expect(screen.getByText(/Pattern: f\.last/)).toBeTruthy();
    // and the matching candidate is the one highlighted
    const row = screen.getByText("j.doe@acme.com").closest("button")!;
    // jsdom re-serialises the inline style, so match on the normalised form.
    expect(row.getAttribute("style")).toContain("rgba(0, 255, 133, 0.1)");
  });

  it("reports honest ambiguity instead of picking a rule", () => {
    render(<EmailPermutations domain="x.com" />);
    typeName("Jane Doe");
    fireEvent.change(screen.getByPlaceholderText("That person's full name"), { target: { value: "Sam Sam" } });
    fireEvent.change(screen.getByPlaceholderText("known.person@x.com"), { target: { value: "sam.sam@x.com" } });
    expect(screen.getByText(/Fits 2 rules equally \(first\.last, last\.first\)/)).toBeTruthy();
  });

  it("says so when the known address fits no rule at all", () => {
    render(<EmailPermutations domain="acme.com" />);
    typeName("Jane Doe");
    fireEvent.change(screen.getByPlaceholderText("That person's full name"), { target: { value: "John Smith" } });
    fireEvent.change(screen.getByPlaceholderText("known.person@acme.com"), { target: { value: "jonny@acme.com" } });
    expect(screen.getByText(/does not match any pattern here/)).toBeTruthy();
  });

  it("shows no verdict until both known fields are filled", () => {
    render(<EmailPermutations domain="acme.com" />);
    typeName("Jane Doe");
    fireEvent.change(screen.getByPlaceholderText("known.person@acme.com"), { target: { value: "j.smith@acme.com" } });
    expect(screen.queryByText(/Pattern:/)).toBeNull();
    expect(screen.queryByText(/does not match any pattern/)).toBeNull();
  });

  it("produces nothing for a name that normalises away", () => {
    render(<EmailPermutations domain="acme.com" />);
    typeName("!!! ###");
    expect(screen.queryByText(/Copy all/)).toBeNull();
  });
});
