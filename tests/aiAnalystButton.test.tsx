// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AiAnalystButton from "@/components/shared/AiAnalystButton";
import type { AiAnalysis } from "@/lib/ai";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* storage may be unavailable */ }
});

const analysis = {
  kind: "email",
  subject: "victim@example.com",
  signals: [],
  risk: { score: 62, band: "high", confidence: "high", rationale: "Leaked credentials.", factors: [{ label: "Password exposed", share: 1, evidence: "a breach exposed a password" }] },
  anomalies: [],
  summary: ["victim@example.com scores 62 out of 100."],
} as unknown as AiAnalysis;

// postLookup reads res.text() then JSON.parses it; a stub Response only needs
// ok/status/text/headers.
const resp = (status: number, data: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
    headers: { get: () => null },
  }) as unknown as Response;

describe("<AiAnalystButton>", () => {
  it("is idle by default and shows the local-provider disclosure", () => {
    render(<AiAnalystButton analysis={analysis} />);
    expect(screen.getByRole("button", { name: /Run analyst/i })).toBeTruthy();
    expect(screen.getByText(/Nothing leaves this machine/i)).toBeTruthy();
  });

  it("switches disclosure and default model when the provider changes", () => {
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "openai" } });
    expect(screen.getByText(/OpenAI's API/i)).toBeTruthy();
    const modelSelect = screen.getByLabelText("Analyst model") as HTMLSelectElement;
    expect(modelSelect.value).toBe("gpt-4o-mini");
    // Picking another catalogued model updates the selection.
    fireEvent.change(modelSelect, { target: { value: "gpt-4o" } });
    expect((screen.getByLabelText("Analyst model") as HTMLSelectElement).value).toBe("gpt-4o");
  });

  it("offers the newer providers in the picker", () => {
    render(<AiAnalystButton analysis={analysis} />);
    const labels = Array.from((screen.getByLabelText("Analyst provider") as HTMLSelectElement).options)
      .map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Google Gemini", "DeepSeek", "Groq", "Mistral", "OpenRouter"]));
  });

  it("reveals a custom-model box, gates Run on it, and sends what was typed", async () => {
    const fetchMock = vi.fn(async () => resp(200, { text: "brief about victim@example.com" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AiAnalystButton analysis={analysis} />);
    // No custom box until "Custom model…" is chosen.
    expect(screen.queryByLabelText("Custom model name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Analyst model"), { target: { value: "__custom__" } });
    const custom = screen.getByLabelText("Custom model name") as HTMLInputElement;
    expect(custom.value).toBe(""); // blanked so the operator can type
    // An empty model disables Run.
    expect((screen.getByRole("button", { name: /Run analyst/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(custom, { target: { value: "my-local-model" } });
    expect((screen.getByRole("button", { name: /Run analyst/i }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Run analyst/i }));
    await waitFor(() => expect(screen.getByText(/brief about victim/i)).toBeTruthy());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("my-local-model");
  });

  it("keeps a typed custom model when Custom is re-selected", () => {
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.change(screen.getByLabelText("Analyst model"), { target: { value: "__custom__" } });
    fireEvent.change(screen.getByLabelText("Custom model name"), { target: { value: "keep-me" } });
    // Re-selecting Custom while already custom must not wipe the typed value.
    fireEvent.change(screen.getByLabelText("Analyst model"), { target: { value: "__custom__" } });
    expect((screen.getByLabelText("Custom model name") as HTMLInputElement).value).toBe("keep-me");
  });

  it("runs the analyst and flags an identifier the model invented", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      resp(200, { text: "victim@example.com is exposed. Also contact attacker@evil.com." }),
    ));
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.click(screen.getByRole("button", { name: /Run analyst/i }));
    await waitFor(() => expect(screen.getByText(/victim@example.com is exposed/i)).toBeTruthy());
    // The grounded subject is not flagged; the invented address is.
    expect(screen.getByText(/Unverified/i)).toBeTruthy();
    expect(screen.getByText(/email attacker@evil.com/i)).toBeTruthy();
  });

  it("renders a grounded narrative with no unverified warning when the model stays on-evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      resp(200, { text: "The subject victim@example.com carries elevated risk from a breach." }),
    ));
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.click(screen.getByRole("button", { name: /Run analyst/i }));
    await waitFor(() => expect(screen.getByText(/carries elevated risk/i)).toBeTruthy());
    expect(screen.queryByText(/Unverified/i)).toBeNull();
  });

  it("surfaces the relay error and an actionable Ollama hint when the local server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(502, { error: "Could not reach Ollama." })));
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.click(screen.getByRole("button", { name: /Run analyst/i }));
    await waitFor(() => expect(screen.getByText(/Could not reach Ollama/i)).toBeTruthy());
    expect(screen.getByText("ollama serve")).toBeTruthy();
    expect(screen.getByText(/ollama pull/i)).toBeTruthy();
  });

  it("does not show the Ollama hint for a cloud provider's error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(502, { error: "The provider rejected the configured API key." })));
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "openai" } });
    fireEvent.click(screen.getByRole("button", { name: /Run analyst/i }));
    await waitFor(() => expect(screen.getByText(/rejected the configured API key/i)).toBeTruthy());
    expect(screen.queryByText("ollama serve")).toBeNull();
  });

  // ── The in-panel cloud key (do everything here, no terminal) ────────────────

  it("shows an API key field and a link to the provider's key console for a cloud provider", () => {
    render(<AiAnalystButton analysis={analysis} />);
    // No key UI for the local, keyless Ollama.
    expect(screen.queryByLabelText("API key")).toBeNull();
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "anthropic" } });
    expect(screen.getByLabelText("API key")).toBeTruthy();
    const getKey = screen.getByRole("link", { name: /Get a key/i });
    expect(getKey.getAttribute("href")).toBe("https://console.anthropic.com/settings/keys");
    expect(getKey.getAttribute("rel")).toContain("noopener");
    // Switching back to the local, keyless provider removes the key UI again.
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "ollama" } });
    expect(screen.queryByLabelText("API key")).toBeNull();
  });

  it("nudges toward the zero-install cloud path when the local provider is selected", () => {
    render(<AiAnalystButton analysis={analysis} />);
    expect(screen.getByText(/Prefer zero setup/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "openai" } });
    expect(screen.queryByText(/Prefer zero setup/i)).toBeNull();
  });

  it("sends the pasted key in the request body for a cloud provider", async () => {
    const fetchMock = vi.fn(async () => resp(200, { text: "cloud brief about victim@example.com" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "openai" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-live-123" } });
    fireEvent.click(screen.getByRole("button", { name: /Run analyst/i }));
    await waitFor(() => expect(screen.getByText(/cloud brief/i)).toBeTruthy());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent.provider).toBe("openai");
    expect(sent.apiKey).toBe("sk-live-123");
  });

  it("does not send an apiKey field for the keyless local provider", async () => {
    const fetchMock = vi.fn(async () => resp(200, { text: "local brief" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.click(screen.getByRole("button", { name: /Run analyst/i }));
    await waitFor(() => expect(screen.getByText(/local brief/i)).toBeTruthy());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).apiKey).toBeUndefined();
  });

  it("toggles API key visibility between password and text", () => {
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "openai" } });
    expect((screen.getByLabelText("API key") as HTMLInputElement).type).toBe("password");
    fireEvent.click(screen.getByLabelText("Show key"));
    expect((screen.getByLabelText("API key") as HTMLInputElement).type).toBe("text");
    fireEvent.click(screen.getByLabelText("Hide key"));
    expect((screen.getByLabelText("API key") as HTMLInputElement).type).toBe("password");
  });

  it("holds the key in the session only and never writes it to browser storage", () => {
    const first = render(<AiAnalystButton analysis={analysis} />);
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "openai" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-session" } });
    // The secret is a liability at rest: nothing is persisted.
    expect(localStorage.length).toBe(0);
    first.unmount();
    // A fresh mount starts empty — the key was never saved anywhere.
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "openai" } });
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  });

  it("clears the key when switching providers so it is never carried across", () => {
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "openai" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-openai" } });
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "anthropic" } });
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  });

  it("offers a Get key link and a check-your-key hint on a cloud provider's error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(502, { error: "The provider rejected the configured API key." })));
    render(<AiAnalystButton analysis={analysis} />);
    fireEvent.change(screen.getByLabelText("Analyst provider"), { target: { value: "openai" } });
    fireEvent.click(screen.getByRole("button", { name: /Run analyst/i }));
    await waitFor(() => expect(screen.getByText(/Check the OpenAI key above/i)).toBeTruthy());
    const links = screen.getAllByRole("link", { name: /Get a/i });
    expect(links.some((l) => l.getAttribute("href") === "https://platform.openai.com/api-keys")).toBe(true);
  });
});
