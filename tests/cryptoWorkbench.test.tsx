// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import CryptoWorkbench from "@/components/hash/CryptoWorkbench";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function runButton(): HTMLElement {
  // The run button shares its label with the direction toggle, but the toggles
  // carry aria-pressed and the run button does not — so exclude those.
  return screen.getAllByRole("button").find(
    (b) => /^(Compute|Encode|Decode|Encrypt|Decrypt)$/.test(b.textContent || "") && !b.hasAttribute("aria-pressed"),
  )!;
}
async function clickRun() {
  await act(async () => { fireEvent.click(runButton()); });
}

describe("<CryptoWorkbench> digests", () => {
  it("computes an MD5 by default, with no key field and no direction toggle", async () => {
    render(<CryptoWorkbench />);
    expect(screen.queryByLabelText(/Secret key/)).toBeNull();
    expect(screen.queryByText("Encode")).toBeNull(); // digest is one-way
    type("Input text", "abc");
    await clickRun();
    expect(screen.getByLabelText("Output")).toHaveProperty("value", "900150983cd24fb0d6963f7d28e17f72");
  });

  it("switches to SHA-256 within the digest category", async () => {
    render(<CryptoWorkbench />);
    fireEvent.click(screen.getByRole("option", { name: "SHA-256" }));
    type("Input text", "abc");
    await clickRun();
    expect(screen.getByLabelText("Output")).toHaveProperty(
      "value", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("<CryptoWorkbench> encode/decode", () => {
  it("encodes then decodes Base64 with the direction toggle", async () => {
    render(<CryptoWorkbench />);
    fireEvent.click(screen.getByRole("tab", { name: /Encode \/ decode/i }));
    type("Input text", "hello");
    await clickRun();
    expect(screen.getByLabelText("Output")).toHaveProperty("value", "aGVsbG8=");

    // Focusing the output selects it for easy copy.
    fireEvent.focus(screen.getByLabelText("Output"));

    // Flip to Decode, move the output into the input, and reverse it.
    fireEvent.click(screen.getByRole("button", { name: "Decode" }));
    type("Input text", "aGVsbG8=");
    await clickRun();
    expect(screen.getByLabelText("Output")).toHaveProperty("value", "hello");

    // Flip back to Encode (covers the forward-direction toggle).
    fireEvent.click(screen.getByRole("button", { name: "Encode" }));
    expect(screen.queryByLabelText("Output")).toBeNull(); // toggling clears the result
  });

  it("shows an inline error for malformed Base64 on decode", async () => {
    render(<CryptoWorkbench />);
    fireEvent.click(screen.getByRole("tab", { name: /Encode \/ decode/i }));
    fireEvent.click(screen.getByRole("button", { name: "Decode" }));
    type("Input text", "****");
    await clickRun();
    expect(screen.getByText(/not valid Base64/i)).toBeTruthy();
    expect(screen.queryByLabelText("Output")).toBeNull(); // no output block on error
  });
});

describe("<CryptoWorkbench> keyed algorithms", () => {
  it("requires a key for HMAC and surfaces the guard, then computes with one", async () => {
    render(<CryptoWorkbench />);
    fireEvent.click(screen.getByRole("tab", { name: /HMAC/i }));
    type("Input text", "msg");
    await clickRun(); // no key yet
    expect(screen.getByText(/is required/i)).toBeTruthy();

    type(/Secret key/, "k");
    await clickRun();
    // Known HMAC-SHA256("msg","k") — verified by the lib suite; assert it is hex.
    await waitFor(() => expect((screen.getByLabelText("Output") as HTMLTextAreaElement).value).toMatch(/^[0-9a-f]{64}$/));
  });

  it("encrypts and decrypts with AES-256-GCM and shows the note", async () => {
    render(<CryptoWorkbench />);
    fireEvent.click(screen.getByRole("tab", { name: /Encrypt \/ decrypt/i }));
    type("Input text", "top secret paragraph");
    type(/Passphrase/, "pw");
    await clickRun();
    // PBKDF2 (210k iterations) settles after the click, so poll for the result.
    // Match the note text specifically (the algorithm button also says AES-256-GCM).
    await waitFor(() => expect(screen.getByText(/PBKDF2-SHA256/)).toBeTruthy());
    const token = (screen.getByLabelText("Output") as HTMLTextAreaElement).value;
    expect(token).not.toContain("top secret");

    // Decrypt it back.
    fireEvent.click(screen.getByRole("button", { name: "Decrypt" }));
    type("Input text", token);
    await clickRun();
    await waitFor(() => expect((screen.getByLabelText("Output") as HTMLTextAreaElement).value).toBe("top secret paragraph"));
  });
});

describe("<CryptoWorkbench> output controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  it("copies the output and reverts the label after the timeout", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CryptoWorkbench />);
    type("Input text", "abc");
    const runBtn = screen.getAllByRole("button").find((b) => b.textContent === "Compute")!;
    await act(async () => { fireEvent.click(runBtn); });

    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith("900150983cd24fb0d6963f7d28e17f72");
    expect(screen.getByText("Copied")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(screen.getByText("Copy")).toBeTruthy();
  });

  it("moves the output into the input via 'Use as input', then clears", async () => {
    render(<CryptoWorkbench />);
    type("Input text", "abc");
    const runBtn = screen.getAllByRole("button").find((b) => b.textContent === "Compute")!;
    await act(async () => { fireEvent.click(runBtn); });

    fireEvent.click(screen.getByRole("button", { name: /Use as input/ }));
    expect(screen.getByLabelText("Input text")).toHaveProperty("value", "900150983cd24fb0d6963f7d28e17f72");
    expect(screen.queryByLabelText("Output")).toBeNull(); // swap clears the result

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Input text")).toHaveProperty("value", "");
  });
});

describe("<CryptoWorkbench> copy without a clipboard", () => {
  it("does not throw when the clipboard API is unavailable", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    render(<CryptoWorkbench />);
    type("Input text", "abc");
    const runBtn = screen.getAllByRole("button").find((b) => b.textContent === "Compute")!;
    await act(async () => { fireEvent.click(runBtn); });
    // Should silently no-op rather than crash the panel.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Copy/ })); });
    expect(screen.getByText("Copied")).toBeTruthy();
  });
});

describe("<CryptoWorkbench> classical ciphers", () => {
  it("runs a Caesar shift and reports a bad shift inline", async () => {
    render(<CryptoWorkbench />);
    fireEvent.click(screen.getByRole("tab", { name: /Classical cipher/i }));
    type("Input text", "abc");
    type(/Shift/, "3");
    await clickRun();
    expect(screen.getByLabelText("Output")).toHaveProperty("value", "def");
    // A non-numeric shift surfaces as an error.
    type(/Shift/, "oops");
    await clickRun();
    expect(screen.getByText(/whole number/)).toBeTruthy();
  });
});
