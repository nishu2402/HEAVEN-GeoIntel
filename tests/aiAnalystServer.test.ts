import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analystStatus, runAnalyst, listModels } from "@/lib/server/aiAnalyst";
import { setKey, clearAllKeys } from "@/lib/server/keyStore";

// The server relay resolves the provider key from the store then the environment,
// calls the provider through the shared fetch, and returns just the completion
// text. Every failure path (no key, unreachable, non-2xx, empty completion) is
// exercised with a stubbed fetch so nothing actually leaves the test process.
//
// HV_DATA_DIR points the key store at a throwaway directory, so these tests
// neither read a developer's real keys nor write to the project's .data.

const prompt = { system: "SYS", user: "USR" };

const jsonResp = (status: number, data: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "hv-analyst-srv-")); process.env.HV_DATA_DIR = dir; });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.HV_DATA_DIR; });

afterEach(async () => {
  vi.unstubAllGlobals();
  await clearAllKeys();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OLLAMA_HOST;
});

describe("runAnalyst", () => {
  it("calls a local Ollama server with no key and returns its text", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      calls.push(String(u));
      return jsonResp(200, { message: { content: "grounded assessment" } });
    }));
    const r = await runAnalyst("ollama", "llama3.2", prompt);
    expect(r).toEqual({ ok: true, text: "grounded assessment", status: 200 });
    expect(calls[0]).toBe("http://127.0.0.1:11434/api/chat");
  });

  it("honours OLLAMA_HOST when set", async () => {
    process.env.OLLAMA_HOST = "http://ollama.local:11434";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      calls.push(String(u));
      return jsonResp(200, { message: { content: "ok" } });
    }));
    await runAnalyst("ollama", "llama3.2", prompt);
    expect(calls[0]).toBe("http://ollama.local:11434/api/chat");
  });

  it("refuses a cloud provider with no configured key and points to the panel", async () => {
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No API key for OpenAI/);
    expect(r.error).toMatch(/Paste one in the AI Analyst panel and press Save/);
    expect(r.error).toMatch(/OPENAI_API_KEY/);
    // No request was made, so there is no gateway to blame for this one.
    expect(r.status).toBe(400);
  });

  it("uses a key saved from the panel, with no env var set", async () => {
    await setKey("OPENAI_API_KEY", "sk-stored");
    const seen: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string | URL, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return jsonResp(200, { choices: [{ message: { content: "stored" } }] });
    }));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt);
    expect(r).toEqual({ ok: true, text: "stored", status: 200 });
    expect(seen[0]).toBe("Bearer sk-stored");
  });

  it("prefers a saved key over the environment, and a pasted one over both", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    await setKey("OPENAI_API_KEY", "sk-stored");
    const seen: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string | URL, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return jsonResp(200, { choices: [{ message: { content: "ok" } }] });
    }));
    await runAnalyst("openai", "gpt-4o-mini", prompt);
    expect(seen[0]).toBe("Bearer sk-stored");
    await runAnalyst("openai", "gpt-4o-mini", prompt, "sk-pasted");
    expect(seen[1]).toBe("Bearer sk-pasted");
  });

  it("relays to a cloud provider when the key is present", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, { choices: [{ message: { content: "cloud text" } }] })));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt);
    expect(r).toEqual({ ok: true, text: "cloud text", status: 200 });
  });

  // fetchSafe normalises init.headers into a Headers object before calling
  // fetch, so read the outbound auth header through Headers.get.
  const authOf = (init: RequestInit) => new Headers(init.headers).get("authorization");

  it("uses a browser-supplied key, taking precedence over the server env var", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const seen: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string | URL, init: RequestInit) => {
      seen.push(authOf(init));
      return jsonResp(200, { choices: [{ message: { content: "byo" } }] });
    }));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt, "sk-browser");
    expect(r).toEqual({ ok: true, text: "byo", status: 200 });
    // The pasted key wins over the environment one.
    expect(seen[0]).toBe("Bearer sk-browser");
  });

  it("relays with a browser key even when no env var is set", async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string | URL, init: RequestInit) => {
      seen.push(authOf(init));
      return jsonResp(200, { choices: [{ message: { content: "ok" } }] });
    }));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt, "sk-only-browser");
    expect(r.ok).toBe(true);
    expect(seen[0]).toBe("Bearer sk-only-browser");
  });

  it("ignores a blank browser key and falls back to the env var", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const seen: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string | URL, init: RequestInit) => {
      seen.push(authOf(init));
      return jsonResp(200, { choices: [{ message: { content: "ok" } }] });
    }));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt, "   ");
    expect(r.ok).toBe(true);
    expect(seen[0]).toBe("Bearer sk-env");
  });

  it("ignores any browser key for the local Ollama provider", async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string | URL, init: RequestInit) => {
      seen.push(authOf(init));
      return jsonResp(200, { message: { content: "local" } });
    }));
    const r = await runAnalyst("ollama", "llama3.2", prompt, "sk-should-be-ignored");
    expect(r).toEqual({ ok: true, text: "local", status: 200 });
    // Ollama carries no auth header regardless of what the browser sent.
    expect(seen[0]).toBeNull();
  });

  it("resolves a newer provider's key and endpoint and extracts its shape", async () => {
    process.env.GEMINI_API_KEY = "g-test";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      calls.push(String(u));
      return jsonResp(200, { candidates: [{ content: { parts: [{ text: "gemini text" }] } }] });
    }));
    const r = await runAnalyst("gemini", "gemini-1.5-flash", prompt);
    expect(r).toEqual({ ok: true, text: "gemini text", status: 200 });
    expect(calls[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent");
  });

  it("reports a friendly message when Ollama is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const r = await runAnalyst("ollama", "llama3.2", prompt);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not reach Ollama on this machine/);
    // Nothing answered, so this one really is a bad gateway.
    expect(r.status).toBe(502);
  });

  it("separates a missing Ollama model from an Ollama that is not running", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(404, {})));
    const r = await runAnalyst("ollama", "qwen2.5", prompt);
    expect(r.error).toMatch(/does not have the model "qwen2\.5"/);
    expect(r.error).not.toMatch(/Could not reach/);
    // The operator picks another model, so it is their 400, not our 502.
    expect(r.status).toBe(400);
  });

  it("maps a rejected cloud key to a clear error", async () => {
    process.env.ANTHROPIC_API_KEY = "key";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(401, {})));
    const r = await runAnalyst("anthropic", "claude-3-5-haiku-latest", prompt);
    expect(r.error).toMatch(/rejected that API key/);
    expect(r.status).toBe(400);
  });

  it("names both causes for a 400, which Gemini returns for a bad key", async () => {
    process.env.GEMINI_API_KEY = "bad";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(400, {})));
    const r = await runAnalyst("gemini", "gemini-1.5-flash", prompt);
    expect(r.error).toMatch(/Check the API key and the model name/);
    expect(r.status).toBe(400);
  });

  it("maps a cloud rate limit to a retry message", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(429, {})));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt);
    expect(r.error).toMatch(/rate-limiting/);
    // Passed through so a caller backs off rather than retrying blindly.
    expect(r.status).toBe(429);
  });

  it("maps any other cloud failure to a generic message", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(500, {})));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt);
    expect(r.error).toMatch(/unreachable or returned an error/);
    expect(r.status).toBe(502);
  });

  it("names a retired model as the fixable thing it is, quoting the provider", async () => {
    // The bug this whole path exists for: Google withdrew the model the panel
    // shipped with, answered 404 with the replacement's name in the message,
    // and the relay reported "unreachable or returned an error".
    process.env.GEMINI_API_KEY = "g-test";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(404, {
      error: { message: "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash." },
    })));
    const r = await runAnalyst("gemini", "gemini-2.5-flash", prompt);
    expect(r.error).toMatch(/Google Gemini does not offer the model "gemini-2\.5-flash" to this key/);
    expect(r.error).toMatch(/The provider said: This model models\/gemini-2\.5-flash is no longer available/);
    // The fix is a dropdown, so it is the caller's 400.
    expect(r.status).toBe(400);
  });

  it("passes an overloaded provider through as a wait, not a fault to debug", async () => {
    process.env.GEMINI_API_KEY = "g-test";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(503, {
      error: { message: "This model is currently experiencing high demand." },
    })));
    const r = await runAnalyst("gemini", "gemini-3.8-flash", prompt);
    expect(r.error).toMatch(/Google Gemini is overloaded right now/);
    expect(r.status).toBe(503);
  });

  it("quotes the provider on a rejected key, a rejected request and a rate limit", async () => {
    process.env.GEMINI_API_KEY = "g-test";
    for (const [status, code] of [[401, 400], [400, 400], [429, 429], [500, 502]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResp(status, { error: { message: `upstream ${status}` } })));
      const r = await runAnalyst("gemini", "m", prompt);
      expect(r.error).toMatch(new RegExp(`The provider said: upstream ${status}$`));
      expect(r.status).toBe(code);
    }
  });

  it("never repeats the key back, even if the provider quotes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(400, {
      error: { message: "API key sk-secret-value is not valid" },
    })));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt, "sk-secret-value");
    expect(r.error).not.toContain("sk-secret-value");
    expect(r.error).toMatch(/API key \[key\] is not valid/);
  });

  it("says a ceiling was hit rather than calling a truncated answer empty", async () => {
    process.env.GEMINI_API_KEY = "g-test";
    // A thinking model can spend the whole budget before it writes a word.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, {
      candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
    })));
    const r = await runAnalyst("gemini", "gemini-3.8-flash", prompt);
    expect(r.error).toMatch(/spent its whole output budget/);
    expect(r.status).toBe(502);
  });

  it("rejects an empty completion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, { message: { content: "   " } })));
    const r = await runAnalyst("ollama", "llama3.2", prompt);
    expect(r).toEqual({ ok: false, error: "The model returned an empty response.", status: 502 });
  });
});

// ── Readiness ────────────────────────────────────────────────────────────────
// What the panel asks on open. Before this existed the panel opened on Ollama
// whether or not Ollama was installed, so the first thing most operators saw was
// an error and two terminal commands.

describe("analystStatus", () => {
  const tags = (models: unknown[]) =>
    vi.fn(async () => jsonResp(200, { models }));
  const find = (s: Awaited<ReturnType<typeof analystStatus>>, id: string) =>
    s.providers.find((p) => p.id === id)!;

  it("reports the models a running Ollama actually holds and recommends it", async () => {
    vi.stubGlobal("fetch", tags([{ name: "llama3:latest" }, { name: "qwen2.5" }]));
    const s = await analystStatus();
    expect(s.ollamaRunning).toBe(true);
    expect(s.recommended).toBe("ollama");
    const local = find(s, "ollama");
    expect(local.ready).toBe(true);
    expect(local.models).toEqual(["llama3:latest", "qwen2.5"]);
    expect(local.hint).toBe("");
  });

  it("drops a nameless entry from the model list", async () => {
    vi.stubGlobal("fetch", tags([{ name: "llama3:latest" }, {}, { name: "" }]));
    expect(find(await analystStatus(), "ollama").models).toEqual(["llama3:latest"]);
  });

  it("treats a running Ollama with no models as not ready, and says why", async () => {
    vi.stubGlobal("fetch", tags([]));
    const s = await analystStatus();
    expect(s.ollamaRunning).toBe(true);
    expect(find(s, "ollama").ready).toBe(false);
    expect(find(s, "ollama").hint).toMatch(/no model installed/);
    expect(s.recommended).toBeNull();
  });

  it("treats a body with no models field as an empty install", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, {})));
    expect(find(await analystStatus(), "ollama").models).toEqual([]);
  });

  it("reports an unreachable Ollama without recommending it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const s = await analystStatus();
    expect(s.ollamaRunning).toBe(false);
    expect(find(s, "ollama").hint).toMatch(/not running/);
    expect(s.recommended).toBeNull();
  });

  it("marks a cloud provider ready from a saved key, and names its origin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    await setKey("GROQ_API_KEY", "gsk-stored");
    const s = await analystStatus();
    expect(find(s, "groq")).toMatchObject({ ready: true, keySource: "ui", hint: "" });
    // With no local server, the keyed cloud provider is what the panel adopts.
    expect(s.recommended).toBe("groq");
  });

  it("marks a cloud provider ready from the environment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    expect(find(await analystStatus(), "anthropic")).toMatchObject({ ready: true, keySource: "env" });
  });

  it("prefers the local server over a keyed cloud provider", async () => {
    vi.stubGlobal("fetch", tags([{ name: "llama3:latest" }]));
    process.env.OPENAI_API_KEY = "sk-env";
    const s = await analystStatus();
    expect(find(s, "openai").ready).toBe(true);
    expect(s.recommended).toBe("ollama");
  });

  it("never reports a key value, only its presence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    await setKey("MISTRAL_API_KEY", "super-secret-value");
    expect(JSON.stringify(await analystStatus())).not.toContain("super-secret-value");
  });

  it("probes the host OLLAMA_HOST names", async () => {
    process.env.OLLAMA_HOST = "http://ollama.local:11434/";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      calls.push(String(u));
      return jsonResp(200, { models: [] });
    }));
    await analystStatus();
    expect(calls[0]).toBe("http://ollama.local:11434/api/tags");
  });
});

// ── Model discovery ──────────────────────────────────────────────────────────
// The panel offered a list compiled at build time; the provider is the only
// authority on what a key may actually call.

describe("listModels", () => {
  it("asks the provider and returns its list, vetted models first", async () => {
    await setKey("GEMINI_API_KEY", "g-stored");
    const seen: { url: string; key: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL, init: RequestInit) => {
      seen.push({ url: String(u), key: new Headers(init.headers).get("x-goog-api-key") });
      return jsonResp(200, {
        models: [
          { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/imagen-4.0", supportedGenerationMethods: ["generateContent"] },
        ],
      });
    }));
    const r = await listModels("gemini");
    expect(r.models).toEqual(["gemini-3.6-flash", "gemini-2.5-flash"]);
    expect(r.error).toBeUndefined();
    expect(seen[0].url).toContain("/models?pageSize=200");
    // The same key a completion would use, so a key that lists is one that runs.
    expect(seen[0].key).toBe("g-stored");
  });

  it("asks for nothing when there is no key to ask with", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await listModels("openai");
    expect(r).toEqual({ models: [], error: "No API key saved for OpenAI." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a provider that refuses to list, with its reason", async () => {
    process.env.OPENAI_API_KEY = "sk-bad";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(401, { error: { message: "Incorrect API key" } })));
    const r = await listModels("openai");
    expect(r.models).toEqual([]);
    expect(r.error).toMatch(/rejected that API key.*The provider said: Incorrect API key/);
  });
});
