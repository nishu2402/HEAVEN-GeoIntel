// ── AI analyst relay (server-only) ───────────────────────────────────────────
//
// The one place a subject's evidence bundle can leave the machine, and only when
// the operator has opted in. It resolves the provider key from the environment
// (never from the browser, never logged), builds the request with the pure
// shaper in ../ai/analyst, calls the provider through the resilient fetch, and
// returns just the completion text. Ollama needs no key and stays on localhost,
// so the default posture transmits nothing off the box.

import { fetchJson } from "./fetchSafe";
import {
  providerRequest, providerExtractText, DEFAULT_ENDPOINT, PROVIDER_LABEL,
  type AnalystProvider, type AnalystPrompt,
} from "../ai/analyst";

// The env var each cloud provider's key is read from. Ollama has none.
const ENV_KEY: Record<Exclude<AnalystProvider, "ollama">, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export interface AnalystRun {
  ok: boolean;
  text?: string;
  /** Set when ok === false: a short, user-safe reason. */
  error?: string;
}

// LLM generation is slow; give it far longer than an OSINT source call.
const ANALYST_TIMEOUT = 120_000;

/** Map a provider + HTTP status to a short, user-safe failure message. */
function analystError(provider: AnalystProvider, status: number): string {
  if (provider === "ollama") {
    return "Could not reach Ollama. Start it with `ollama serve` and pull the model, then try again.";
  }
  if (status === 401 || status === 403) return "The provider rejected the configured API key.";
  if (status === 429) return "The provider is rate-limiting requests right now. Try again shortly.";
  return "The AI provider was unreachable or returned an error.";
}

/**
 * Run the analyst for one prompt. Never throws: a missing key, an unreachable
 * provider or an empty completion all come back as { ok:false, error }.
 *
 * A cloud key can arrive two ways: `browserKey`, pasted into the panel and sent
 * with this one request, or the matching server env var. The panel key wins when
 * present so an operator can run without touching the environment. Either way the
 * key is used here and never persisted or logged.
 */
export async function runAnalyst(
  provider: AnalystProvider,
  model: string,
  prompt: AnalystPrompt,
  browserKey?: string,
): Promise<AnalystRun> {
  let apiKey = "";
  if (provider !== "ollama") {
    apiKey = (browserKey ?? "").trim() || (process.env[ENV_KEY[provider]] ?? "");
    if (!apiKey) {
      return { ok: false, error: `No API key for ${PROVIDER_LABEL[provider]}. Paste your key in the AI Analyst panel, or set ${ENV_KEY[provider]} on the server.` };
    }
  }

  const endpoint = (provider === "ollama" ? process.env.OLLAMA_HOST : undefined) || DEFAULT_ENDPOINT[provider];
  const { url, init } = providerRequest(provider, model, endpoint, prompt, apiKey);

  const r = await fetchJson<unknown>(url, { source: `analyst:${provider}`, init, timeoutMs: ANALYST_TIMEOUT });
  if (!r.ok) return { ok: false, error: analystError(provider, r.status) };

  const text = providerExtractText(provider, r.data);
  if (!text.trim()) return { ok: false, error: "The model returned an empty response." };
  return { ok: true, text };
}
