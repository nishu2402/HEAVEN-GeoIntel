// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import PwnedPasswordCheck from "@/components/hash/PwnedPasswordCheck";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// SHA-1("password") suffix, so a mocked range can hit or miss deterministically.
const PW_SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

const ok = (range: string) =>
  ({ ok: true, status: 200, json: async () => ({ range }) }) as Response;

function type(value: string) {
  fireEvent.change(screen.getByLabelText("Password to check"), { target: { value } });
}
function check() {
  return act(async () => { fireEvent.click(screen.getByRole("button", { name: /Check password/ })); });
}

describe("<PwnedPasswordCheck>", () => {
  it("guards an empty password with an inline message and no request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<PwnedPasswordCheck />);
    await check();
    expect(screen.getByText("Enter a password to check.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a clean password when the suffix is absent from the range", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok("0000000000000000000000000000000000A:1")));
    render(<PwnedPasswordCheck />);
    type("password");
    await check();
    await waitFor(() => expect(screen.getByText(/Not found in the Pwned Passwords corpus/)).toBeTruthy());
  });

  it("reports exposure with the count, pluralised", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(`${PW_SUFFIX}:3861493`)));
    render(<PwnedPasswordCheck />);
    type("password");
    await check();
    await waitFor(() => expect(screen.getByText(/appears in the Pwned Passwords corpus/)).toBeTruthy());
    expect(screen.getByText("3,861,493")).toBeTruthy();
  });

  it("uses the singular for a single sighting and runs on Enter", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(`${PW_SUFFIX}:1`)));
    render(<PwnedPasswordCheck />);
    type("password");
    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Password to check"), { key: "Enter" }); });
    const msg = await screen.findByText(/appears in the Pwned Passwords corpus/);
    // Singular "time", not "times", for a single sighting.
    expect(msg.textContent).toMatch(/\b1\s+time\./);
    expect(msg.textContent).not.toMatch(/times/);
  });

  it("surfaces a service failure inline rather than a false clean", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: "endpoint down" }) }) as Response));
    render(<PwnedPasswordCheck />);
    type("password");
    await check();
    await waitFor(() => expect(screen.getByText("endpoint down")).toBeTruthy());
  });

  it("toggles password visibility", () => {
    render(<PwnedPasswordCheck />);
    const input = screen.getByLabelText("Password to check") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
  });
});
