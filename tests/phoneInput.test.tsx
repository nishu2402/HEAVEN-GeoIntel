// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import PhoneInput from "@/components/phone/PhoneInput";

// PhoneInput drives libphonenumber for real (no mock) — it works in jsdom. The
// tests exercise the country picker, the as-you-type formatter, the three
// validation states, submit/clear, and the outside-click close.

afterEach(cleanup);

const numberField = () => screen.getByPlaceholderText(/number for/i) as HTMLInputElement;
const countryToggle = () => screen.getByRole("button", { name: /^\+\d/ }); // shows "+1", "+44"…

describe("<PhoneInput>", () => {
  it("starts empty with the country-code hint", () => {
    render(<PhoneInput onLookup={() => {}} loading={false} />);
    expect(screen.getByText(/\+1 will be prepended automatically/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /execute lookup/i })).toHaveProperty("disabled", true);
  });

  it("validates a good national number and looks it up on Enter and via the button", () => {
    const onLookup = vi.fn();
    render(<PhoneInput onLookup={onLookup} loading={false} />);
    fireEvent.change(numberField(), { target: { value: "4155552671" } });
    expect(screen.getByText(/valid — will look up:/i)).toBeTruthy();
    expect(screen.getByText("+14155552671")).toBeTruthy();

    fireEvent.keyDown(numberField(), { key: "Enter" });
    expect(onLookup).toHaveBeenCalledWith("+14155552671");
    fireEvent.click(screen.getByRole("button", { name: /execute lookup/i }));
    expect(onLookup).toHaveBeenCalledTimes(2);
  });

  it("flags an invalid number and refuses to submit it", () => {
    const onLookup = vi.fn();
    render(<PhoneInput onLookup={onLookup} loading={false} />);
    fireEvent.change(numberField(), { target: { value: "123" } });
    expect(screen.getByText(/not a valid .* number/i)).toBeTruthy();
    fireEvent.keyDown(numberField(), { key: "Enter" });
    expect(onLookup).not.toHaveBeenCalled();
  });

  it("accepts a fully-qualified +number typed directly (as-you-type formatted)", () => {
    const onLookup = vi.fn();
    render(<PhoneInput onLookup={onLookup} loading={false} />);
    fireEvent.change(numberField(), { target: { value: "+442071838750" } });
    fireEvent.keyDown(numberField(), { key: "Enter" });
    // a leading "+" is passed through as displayed; libphonenumber accepts the spacing
    expect(onLookup).toHaveBeenCalledWith("+44 20 7183 8750");
  });

  it("opens the country picker, filters, and selects a country (resetting the number)", () => {
    render(<PhoneInput onLookup={() => {}} loading={false} />);
    fireEvent.change(numberField(), { target: { value: "4155552671" } });
    fireEvent.click(countryToggle());
    const search = screen.getByPlaceholderText(/search country or code/i);

    fireEvent.change(search, { target: { value: "united kingdom" } });
    const list = search.closest("div")!.parentElement!;
    fireEvent.click(within(list).getByText("United Kingdom"));

    // country switched to +44 and the number field was cleared
    expect(screen.getByRole("button", { name: /^\+44/ })).toBeTruthy();
    expect(numberField().value).toBe("");
  });

  it("selects the sole match on Enter inside the search box", () => {
    render(<PhoneInput onLookup={() => {}} loading={false} />);
    fireEvent.click(countryToggle());
    const search = screen.getByPlaceholderText(/search country or code/i);
    fireEvent.change(search, { target: { value: "united kingdom" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("button", { name: /^\+44/ })).toBeTruthy();
  });

  it("does not select on Enter when the search is ambiguous, and shows a no-results message", () => {
    render(<PhoneInput onLookup={() => {}} loading={false} />);
    fireEvent.click(countryToggle());
    const search = screen.getByPlaceholderText(/search country or code/i);
    fireEvent.change(search, { target: { value: "united" } }); // matches several
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("button", { name: /^\+1/ })).toBeTruthy(); // unchanged

    fireEvent.change(search, { target: { value: "zzzzzz" } });
    expect(screen.getByText(/no results/i)).toBeTruthy();
  });

  it("closes the picker on Escape and on an outside click, but stays open on an inside click", () => {
    render(<PhoneInput onLookup={() => {}} loading={false} />);
    fireEvent.click(countryToggle());
    const search = screen.getByPlaceholderText(/search country or code/i);
    // a mousedown inside the dropdown must NOT close it
    fireEvent.mouseDown(search);
    expect(screen.getByPlaceholderText(/search country or code/i)).toBeTruthy();

    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/search country or code/i)).toBeNull();

    fireEvent.click(countryToggle());
    fireEvent.mouseDown(document.body); // outside
    expect(screen.queryByPlaceholderText(/search country or code/i)).toBeNull();
  });

  it("toggles the picker closed when its own button is clicked again", () => {
    render(<PhoneInput onLookup={() => {}} loading={false} />);
    fireEvent.click(countryToggle());
    expect(screen.getByPlaceholderText(/search country or code/i)).toBeTruthy();
    fireEvent.click(countryToggle());
    expect(screen.queryByPlaceholderText(/search country or code/i)).toBeNull();
  });

  it("shows the SCANNING label and disables submit while loading", () => {
    render(<PhoneInput onLookup={() => {}} loading />);
    fireEvent.change(numberField(), { target: { value: "4155552671" } });
    expect(screen.getByText(/scanning/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /scanning/i })).toHaveProperty("disabled", true);
  });

  it("clears the field and fires onClear", () => {
    const onClear = vi.fn();
    render(<PhoneInput onLookup={() => {}} onClear={onClear} loading={false} />);
    fireEvent.change(numberField(), { target: { value: "4155552671" } });
    fireEvent.click(screen.getByTitle("Clear"));
    expect(numberField().value).toBe("");
    expect(onClear).toHaveBeenCalled();
  });

  it("renders the Clear button when onClear is provided even with an empty field", () => {
    render(<PhoneInput onLookup={() => {}} onClear={() => {}} loading={false} />);
    expect(screen.getByTitle("Clear")).toBeTruthy(); // (raw || onClear) → present
  });

  it("hides the Clear button with no onClear and an empty field", () => {
    render(<PhoneInput onLookup={() => {}} loading={false} />);
    expect(screen.queryByTitle("Clear")).toBeNull();
  });
});
