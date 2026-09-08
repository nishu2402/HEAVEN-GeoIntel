import { describe, it, expect, afterEach, vi } from "vitest";
import { runAnalyst } from "@/lib/server/aiAnalyst";

// The server relay resolves the provider key from the environment, calls the
// provider through the shared fetch, and returns just the completion text. Every
// failure path (no key, unreachable, non-2xx, empty completion) is exercised
// with a stubbed fetch so nothing actually leaves the test process.

const prompt = { system: "SYS", user: "USR" };

const jsonResp = (status: number, data: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(r).toEqual({ ok: true, text: "grounded assessment" });
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
    expect(r.error).toMatch(/Paste your key in the AI Analyst panel/);
    expect(r.error).toMatch(/OPENAI_API_KEY/);
  });

  it("relays to a cloud provider when the key is present", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, { choices: [{ message: { content: "cloud text" } }] })));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt);
    expect(r).toEqual({ ok: true, text: "cloud text" });
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
    expect(r).toEqual({ ok: true, text: "byo" });
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
    expect(r).toEqual({ ok: true, text: "local" });
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
    expect(r).toEqual({ ok: true, text: "gemini text" });
    expect(calls[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent");
  });

  it("reports a friendly message when Ollama is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const r = await runAnalyst("ollama", "llama3.2", prompt);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not reach Ollama/);
  });

  it("maps a rejected cloud key to a clear error", async () => {
    process.env.ANTHROPIC_API_KEY = "key";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(401, {})));
    const r = await runAnalyst("anthropic", "claude-3-5-haiku-latest", prompt);
    expect(r.error).toMatch(/rejected the configured API key/);
  });

  it("maps a cloud rate limit to a retry message", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(429, {})));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt);
    expect(r.error).toMatch(/rate-limiting/);
  });

  it("maps any other cloud failure to a generic message", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(500, {})));
    const r = await runAnalyst("openai", "gpt-4o-mini", prompt);
    expect(r.error).toMatch(/unreachable or returned an error/);
  });

  it("rejects an empty completion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, { message: { content: "   " } })));
    const r = await runAnalyst("ollama", "llama3.2", prompt);
    expect(r).toEqual({ ok: false, error: "The model returned an empty response." });
  });
});
