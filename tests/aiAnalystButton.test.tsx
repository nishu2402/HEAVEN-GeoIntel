// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AiAnalystButton from "@/components/shared/AiAnalystButton";
import type { AiAnalysis } from "@/lib/ai";
import { DEFAULT_MODEL, MODEL_CATALOG } from "@/lib/ai/analyst";

// The panel does its own setup: on mount it asks /api/ai-analyst what this
// machine can actually run, adopts a provider that works, and shows what is
// missing for one that does not. These tests drive that through a routed fetch
// stub — status GET, key POST/DELETE, and the run POST all go through it.

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

// postLookup reads res.text() then JSON.parses it; the status probe reads
// res.json(). A stub Response has to answer both.
const res = (status: number, data: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: { get: () => null },
  }) as unknown as Response;

const IDS = ["ollama", "openai", "anthropic", "gemini", "groq", "deepseek", "mistral", "openrouter"] as const;

interface P { id: string; label: string; ready: boolean; keySource: string | null; models: string[]; hint: string }

/** A status body with every provider unconfigured, minus whatever is overridden. */
function statusBody(over: Partial<Record<(typeof IDS)[number], Partial<P>>> = {}) {
  const providers: P[] = IDS.map((id) => ({
    id, label: id, ready: false, keySource: null, models: [],
    hint: id === "ollama" ? "Ollama is not running on this machine." : "No API key saved for this provider yet.",
    ...(over[id] ?? {}),
  }));
  return {
    providers,
    recommended: providers.find((p) => p.ready)?.id ?? null,
    ollamaRunning: providers[0].ready,
  };
}

interface Opts {
  /** Body for the status GET; null makes the probe reject, as an offline server would. */
  status?: ReturnType<typeof statusBody> | null;
  /** Result of the run POST. */
  run?: { status: number; body: unknown };
  /** Result of a /api/keys write. */
  keys?: { status: number } | "throw";
  /** Body for the model-list GET; "throw" makes it reject, as an offline server would. */
  models?: { status: number; body: unknown } | "throw";
}

function installFetch(opts: Opts = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith("/api/keys")) {
      if (opts.keys === "throw") throw new Error("offline");
      return res(opts.keys?.status ?? 200, { ok: true });
    }
    if (u.includes("?models=")) {
      if (opts.models === "throw") throw new Error("offline");
      const m = opts.models ?? { status: 200, body: {} };
      return res(m.status, m.body);
    }
    if ((init?.method ?? "GET") === "GET") {
      if (opts.status === null) throw new Error("offline");
      return res(200, opts.status ?? statusBody());
    }
    const r = opts.run ?? { status: 200, body: { text: "a grounded brief" } };
    return res(r.status, r.body);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

/** Render and wait for the opening probe to settle. */
async function mount() {
  render(<AiAnalystButton analysis={analysis} />);
  await waitFor(() => expect(screen.queryByText(/Checking what this machine can run/i)).toBeNull());
}

const runButton = () => screen.getByRole("button", { name: /Run analyst/i }) as HTMLButtonElement;
const providerSelect = () => screen.getByLabelText("Analyst provider") as HTMLSelectElement;
const modelSelect = () => screen.getByLabelText("Analyst model") as HTMLSelectElement;

describe("<AiAnalystButton> setup", () => {
  it("says it is checking the machine before it knows", async () => {
    installFetch();
    render(<AiAnalystButton analysis={analysis} />);
    expect(screen.getByText(/Checking what this machine can run/i)).toBeTruthy();
    // Run cannot fire against a provider whose state is still unknown.
    expect(runButton().disabled).toBe(true);
    await waitFor(() => expect(screen.queryByText(/Checking what this machine can run/i)).toBeNull());
  });

  it("adopts the local server when one is running, and offers only its installed models", async () => {
    installFetch({ status: statusBody({ ollama: { ready: true, models: ["llama3:latest", "qwen2.5"], hint: "" } }) });
    await mount();
    expect(providerSelect().value).toBe("ollama");
    expect(screen.getByText(/Ollama \(local\) is ready/i)).toBeTruthy();
    // The model list is what Ollama actually holds, so the first run cannot 404.
    expect(Array.from(modelSelect().options).map((o) => o.value)).toEqual(["llama3:latest", "qwen2.5", "__custom__"]);
    expect(modelSelect().value).toBe("llama3:latest");
    expect(runButton().disabled).toBe(false);
    // Nothing to set up, so no setup block.
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.queryByText("ollama serve")).toBeNull();
  });

  it("adopts a keyed cloud provider when no local server is running", async () => {
    installFetch({ status: statusBody({ groq: { ready: true, keySource: "ui", hint: "" } }) });
    await mount();
    expect(providerSelect().value).toBe("groq");
    expect(screen.getByText(/key saved on this machine/i)).toBeTruthy();
    expect(runButton().disabled).toBe(false);
  });

  it("names the environment as the key's origin when that is where it came from", async () => {
    installFetch({ status: statusBody({ openai: { ready: true, keySource: "env", hint: "" } }) });
    await mount();
    expect(screen.getByText(/key from the server environment/i)).toBeTruthy();
  });

  it("opens on the free-tier provider and its key console when nothing is configured", async () => {
    installFetch();
    await mount();
    // Not the local provider: an operator with nothing installed would only see
    // an error and two terminal commands.
    expect(providerSelect().value).toBe("gemini");
    expect(screen.getByText(/No API key saved for this provider yet/i)).toBeTruthy();
    expect(screen.getByText("free tier")).toBeTruthy();
    const create = screen.getByRole("link", { name: /Create a key/i });
    expect(create.getAttribute("href")).toBe("https://aistudio.google.com/app/apikey");
    expect(create.getAttribute("rel")).toContain("noopener");
    // Nothing to run against yet.
    expect(runButton().disabled).toBe(true);
  });

  it("says so plainly when the server could not be asked at all", async () => {
    installFetch({ status: null });
    await mount();
    expect(screen.getByText(/Could not ask the server which providers are available/i)).toBeTruthy();
    // With no answer to go on, a provider switch still falls back to that
    // provider's suggested model rather than leaving the box empty.
    fireEvent.change(providerSelect(), { target: { value: "anthropic" } });
    expect(modelSelect().value).toBe("claude-3-5-haiku-latest");
  });

  it("treats a failed status response the same as no answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(500, { error: "boom" })));
    await mount();
    expect(screen.getByText(/Could not ask the server which providers are available/i)).toBeTruthy();
  });

  it("falls back to the suggested model for a provider the report omits", async () => {
    installFetch({ status: { providers: [], recommended: null, ollamaRunning: false } });
    await mount();
    fireEvent.change(providerSelect(), { target: { value: "groq" } });
    expect(modelSelect().value).toBe("llama-3.3-70b-versatile");
  });

  it("shows the local install path, with a download link, for a provider that is not running", async () => {
    installFetch();
    await mount();
    fireEvent.change(providerSelect(), { target: { value: "ollama" } });
    expect(screen.getByText(/Ollama is not running on this machine/i)).toBeTruthy();
    expect(screen.getByText("ollama serve")).toBeTruthy();
    expect(screen.getByText(/ollama pull llama3\.2/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Download Ollama/i }).getAttribute("href"))
      .toBe("https://ollama.com/download");
    // And the way out of installing anything at all.
    expect(screen.getByText(/Prefer no install/i)).toBeTruthy();
    expect(runButton().disabled).toBe(true);
  });

  it("falls back to a suggested model name in the pull command when the box is blank", async () => {
    installFetch();
    await mount();
    fireEvent.change(providerSelect(), { target: { value: "ollama" } });
    fireEvent.change(modelSelect(), { target: { value: "__custom__" } });
    expect((screen.getByLabelText("Custom model name") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/ollama pull llama3\.2/i)).toBeTruthy();
  });

  it("re-probes on Check again and flips to ready without a reload", async () => {
    let ready = false;
    vi.stubGlobal("fetch", vi.fn(async () =>
      res(200, ready
        ? statusBody({ ollama: { ready: true, models: ["llama3:latest"], hint: "" } })
        : statusBody()),
    ));
    await mount();
    fireEvent.change(providerSelect(), { target: { value: "ollama" } });
    expect(screen.getByText("ollama serve")).toBeTruthy();
    // Before the server answers there is nothing to enumerate, so the picker
    // shows the suggestion list.
    expect(modelSelect().value).toBe("llama3.2");
    ready = true;
    fireEvent.click(screen.getByRole("button", { name: /Check again/i }));
    await waitFor(() => expect(screen.getByText(/Ollama \(local\) is ready/i)).toBeTruthy());
    expect(screen.queryByText("ollama serve")).toBeNull();
    // And the selection follows what that server actually holds, rather than
    // staying on a suggestion it would 404 on.
    expect(modelSelect().value).toBe("llama3:latest");
  });
});

// ── The model list ───────────────────────────────────────────────────────────
// The dropdown used to offer names compiled into the build. Google withdrew
// every Gemini model in that list, so the panel's own suggestion answered with
// a 404 and there was no way to run the analyst without knowing a name to type.

describe("<AiAnalystButton> models", () => {
  const geminiReady = statusBody({ gemini: { ready: true, keySource: "ui", hint: "" } });
  const options = () => Array.from(modelSelect().options).map((o) => o.value);

  it("offers what the provider lists, and says whose list it is", async () => {
    installFetch({ status: geminiReady, models: { status: 200, body: { models: ["gemini-3.6-flash", "gemini-9-flash"] } } });
    await mount();
    await waitFor(() => expect(options()).toEqual(["gemini-3.6-flash", "gemini-9-flash", "__custom__"]));
    // Said plainly, because a list from the provider and a list from this build
    // are not the same claim.
    expect(screen.getByText(/models Google Gemini lists for your key/i)).toBeTruthy();
    expect(modelSelect().value).toBe("gemini-3.6-flash");
  });

  it("keeps the shipped catalog when the provider will not list", async () => {
    installFetch({ status: geminiReady, models: { status: 500, body: {} } });
    await mount();
    expect(options()).toEqual([...MODEL_CATALOG.gemini, "__custom__"]);
    expect(screen.queryByText(/lists for your key/i)).toBeNull();
  });

  it("keeps the catalog when the list request never lands, or comes back empty", async () => {
    installFetch({ status: geminiReady, models: "throw" });
    await mount();
    expect(options()).toEqual([...MODEL_CATALOG.gemini, "__custom__"]);
    cleanup();

    installFetch({ status: geminiReady, models: { status: 200, body: { models: [] } } });
    await mount();
    expect(options()).toEqual([...MODEL_CATALOG.gemini, "__custom__"]);
  });

  it("asks nothing of a provider that is not set up, or of the local server", async () => {
    const calls = installFetch({ status: statusBody({ ollama: { ready: true, models: ["llama3:latest"], hint: "" } }) });
    await mount();
    // Ollama's models come off the machine with the readiness probe, and an
    // unkeyed cloud provider has nothing to ask with.
    fireEvent.change(providerSelect(), { target: { value: "mistral" } });
    await waitFor(() => expect(providerSelect().value).toBe("mistral"));
    expect(calls.some((c) => c.url.includes("?models="))).toBe(false);
  });

  it("asks each provider once, not once per visit", async () => {
    const calls = installFetch({
      status: statusBody({
        gemini: { ready: true, keySource: "ui", hint: "" },
        groq: { ready: true, keySource: "ui", hint: "" },
      }),
      models: { status: 200, body: { models: ["listed-model"] } },
    });
    await mount();
    await waitFor(() => expect(options()).toContain("listed-model"));
    fireEvent.change(providerSelect(), { target: { value: "groq" } });
    await waitFor(() => expect(calls.filter((c) => c.url.includes("?models=groq"))).toHaveLength(1));
    fireEvent.change(providerSelect(), { target: { value: "gemini" } });
    await waitFor(() => expect(providerSelect().value).toBe("gemini"));
    expect(calls.filter((c) => c.url.includes("?models=gemini"))).toHaveLength(1);
  });
});

describe("<AiAnalystButton> keys", () => {
  it("saves a pasted key to the server under the provider's own key name", async () => {
    const calls = installFetch();
    await mount();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "AIza-test" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(""));
    const save = calls.find((c) => c.url === "/api/keys" && c.init?.method === "POST")!;
    expect(JSON.parse(String(save.init!.body))).toEqual({ name: "GEMINI_API_KEY", value: "AIza-test" });
    // The save is followed by a re-probe, so a now-ready provider shows as ready.
    expect(calls.filter((c) => c.url === "/api/ai-analyst" && (c.init?.method ?? "GET") === "GET").length).toBe(2);
  });

  it("keeps what was pasted when the server rejects the key", async () => {
    installFetch({ keys: { status: 400 } });
    await mount();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "bad-key" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(screen.getByText(/server rejected that key/i)).toBeTruthy());
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("bad-key");
  });

  it("reports an unreachable server rather than losing the key", async () => {
    installFetch({ keys: "throw" });
    await mount();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "AIza-test" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(screen.getByText(/Could not reach the server to save the key/i)).toBeTruthy());
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("AIza-test");
  });

  it("Save is disabled until something is typed", async () => {
    installFetch();
    await mount();
    expect((screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: " " } });
    expect((screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "k" } });
    expect((screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("removes a saved key, and only offers that for one saved here", async () => {
    const calls = installFetch({
      status: statusBody({ gemini: { ready: true, keySource: "ui", hint: "" } }),
      run: { status: 400, body: { error: "rejected" } },
    });
    await mount();
    // Ready, so the block stays hidden until a run fails.
    expect(screen.queryByRole("button", { name: /Remove the saved key/i })).toBeNull();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByRole("button", { name: /Remove the saved key/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Remove the saved key/i }));
    await waitFor(() => expect(
      calls.some((c) => c.url.startsWith("/api/keys?name=GEMINI_API_KEY") && c.init?.method === "DELETE"),
    ).toBe(true));
  });

  it("reports a failed removal instead of pretending the key is gone", async () => {
    installFetch({ status: statusBody({ gemini: { ready: true, keySource: "ui", hint: "" } }), keys: { status: 400 }, run: { status: 400, body: { error: "rejected" } } });
    await mount();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByRole("button", { name: /Remove the saved key/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Remove the saved key/i }));
    await waitFor(() => expect(screen.getByText(/could not remove that key/i)).toBeTruthy());
  });

  it("reports an unreachable server on removal", async () => {
    installFetch({ status: statusBody({ gemini: { ready: true, keySource: "ui", hint: "" } }), keys: "throw", run: { status: 400, body: { error: "rejected" } } });
    await mount();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByRole("button", { name: /Remove the saved key/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Remove the saved key/i }));
    await waitFor(() => expect(screen.getByText(/Could not reach the server to remove the key/i)).toBeTruthy());
  });

  it("toggles key visibility between password and text", async () => {
    installFetch();
    await mount();
    expect((screen.getByLabelText("API key") as HTMLInputElement).type).toBe("password");
    fireEvent.click(screen.getByLabelText("Show key"));
    expect((screen.getByLabelText("API key") as HTMLInputElement).type).toBe("text");
    fireEvent.click(screen.getByLabelText("Hide key"));
    expect((screen.getByLabelText("API key") as HTMLInputElement).type).toBe("password");
  });

  it("never writes a key to browser storage, and never carries one between providers", async () => {
    installFetch();
    const first = render(<AiAnalystButton analysis={analysis} />);
    await waitFor(() => expect(screen.getByLabelText("API key")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "AIza-session" } });
    expect(localStorage.length).toBe(0);
    fireEvent.change(providerSelect(), { target: { value: "anthropic" } });
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    first.unmount();
    await mount();
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  });
});

describe("<AiAnalystButton> running", () => {
  it("runs a one-off key without saving it first", async () => {
    const calls = installFetch();
    await mount();
    expect(runButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "AIza-once" } });
    expect(runButton().disabled).toBe(false);
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText(/a grounded brief/i)).toBeTruthy());
    const run = calls.find((c) => c.url === "/api/ai-analyst" && c.init?.method === "POST")!;
    const sent = JSON.parse(String(run.init!.body));
    expect(sent).toMatchObject({ provider: "gemini", model: DEFAULT_MODEL.gemini, apiKey: "AIza-once" });
    // No key was written to the server: this one was used and forgotten.
    expect(calls.some((c) => c.url.startsWith("/api/keys"))).toBe(false);
  });

  it("sends no key for the local provider", async () => {
    const calls = installFetch({ status: statusBody({ ollama: { ready: true, models: ["llama3:latest"], hint: "" } }) });
    await mount();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText(/a grounded brief/i)).toBeTruthy());
    const run = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(run.init!.body)).apiKey).toBeUndefined();
  });

  it("flags an identifier the model invented and leaves grounded ones alone", async () => {
    installFetch({
      status: statusBody({ ollama: { ready: true, models: ["llama3:latest"], hint: "" } }),
      run: { status: 200, body: { text: "victim@example.com is exposed. Also contact attacker@evil.com." } },
    });
    await mount();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText(/victim@example.com is exposed/i)).toBeTruthy());
    expect(screen.getByText(/Unverified/i)).toBeTruthy();
    expect(screen.getByText(/email attacker@evil.com/i)).toBeTruthy();
  });

  it("shows no unverified warning when the model stays on the evidence", async () => {
    installFetch({
      status: statusBody({ ollama: { ready: true, models: ["llama3:latest"], hint: "" } }),
      run: { status: 200, body: { text: "The subject victim@example.com carries elevated risk from a breach." } },
    });
    await mount();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText(/carries elevated risk/i)).toBeTruthy());
    expect(screen.queryByText(/Unverified/i)).toBeNull();
  });

  it("reopens the key block when a configured cloud provider rejects the run", async () => {
    installFetch({
      status: statusBody({ openai: { ready: true, keySource: "env", hint: "" } }),
      run: { status: 400, body: { error: "The provider rejected that API key." } },
    });
    await mount();
    // A ready provider hides the key field until something goes wrong.
    expect(screen.queryByLabelText("API key")).toBeNull();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText(/rejected that API key/i)).toBeTruthy());
    // The fix has to be reachable from the error, not from a terminal.
    expect(screen.getByLabelText("API key")).toBeTruthy();
    // And the failure must not sit under a line still calling the provider ready.
    expect(screen.queryByText(/OpenAI is ready/i)).toBeNull();
    expect(screen.getByRole("link", { name: /Create a key/i }).getAttribute("href"))
      .toBe("https://platform.openai.com/api-keys");
  });

  it("reopens the local block when a running Ollama rejects the run", async () => {
    installFetch({
      status: statusBody({ ollama: { ready: true, models: ["llama3:latest"], hint: "" } }),
      run: { status: 400, body: { error: "Ollama is running but does not have the model" } },
    });
    await mount();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText("ollama serve")).toBeTruthy());
    // Check again clears the failed run with it: leaving the error on screen
    // under a provider that has just come back reads as a fresh failure.
    fireEvent.click(screen.getByRole("button", { name: /Check again/i }));
    await waitFor(() => expect(screen.getByText(/Ollama \(local\) is ready/i)).toBeTruthy());
    expect(screen.queryByText(/does not have the model/i)).toBeNull();
  });

  it("switches disclosure and default model with the provider", async () => {
    installFetch({ status: statusBody({ ollama: { ready: true, models: ["llama3:latest"], hint: "" } }) });
    await mount();
    expect(screen.getByText(/Nothing leaves this machine/i)).toBeTruthy();
    fireEvent.change(providerSelect(), { target: { value: "openai" } });
    expect(screen.getByText(/OpenAI's API/i)).toBeTruthy();
    expect(modelSelect().value).toBe("gpt-4o-mini");
    fireEvent.change(modelSelect(), { target: { value: "gpt-4o" } });
    expect(modelSelect().value).toBe("gpt-4o");
  });

  it("offers every provider in the picker", async () => {
    installFetch();
    await mount();
    expect(Array.from(providerSelect().options).map((o) => o.textContent))
      .toEqual(expect.arrayContaining(["Ollama (local)", "Google Gemini", "DeepSeek", "Groq", "Mistral", "OpenRouter"]));
  });

  it("takes a custom model, gates Run on it, and sends what was typed", async () => {
    const calls = installFetch({ status: statusBody({ ollama: { ready: true, models: ["llama3:latest"], hint: "" } }) });
    await mount();
    expect(screen.queryByLabelText("Custom model name")).toBeNull();
    fireEvent.change(modelSelect(), { target: { value: "__custom__" } });
    const custom = screen.getByLabelText("Custom model name") as HTMLInputElement;
    expect(custom.value).toBe("");
    expect(runButton().disabled).toBe(true);
    fireEvent.change(custom, { target: { value: "my-local-model" } });
    expect(runButton().disabled).toBe(false);
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText(/a grounded brief/i)).toBeTruthy());
    const run = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(run.init!.body)).model).toBe("my-local-model");
  });

  it("keeps a typed custom model when Custom is re-selected", async () => {
    installFetch({ status: statusBody({ ollama: { ready: true, models: ["llama3:latest"], hint: "" } }) });
    await mount();
    fireEvent.change(modelSelect(), { target: { value: "__custom__" } });
    fireEvent.change(screen.getByLabelText("Custom model name"), { target: { value: "keep-me" } });
    fireEvent.change(modelSelect(), { target: { value: "__custom__" } });
    expect((screen.getByLabelText("Custom model name") as HTMLInputElement).value).toBe("keep-me");
  });
});
