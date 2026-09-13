// ── AI analyst relay (server-only) ───────────────────────────────────────────
//
// The one place a subject's evidence bundle can leave the machine, and only when
// the operator has opted in. It resolves the provider key from the key store or
// the environment (never from the browser, never logged), builds the request with
// the pure shaper in ../ai/analyst, calls the provider through the resilient
// fetch, and returns just the completion text.
//
// It also answers "what can this machine actually run?" — see analystStatus.
// The panel used to open on Ollama whether or not Ollama was installed, so the
// first thing most operators saw was a red error and two terminal commands. Now
// the server probes the local server and the saved keys, and the panel selects
// something that works.

import { fetchJson } from "./fetchSafe";
import { configuredMap, resolveKey, type KeySource } from "./keyStore";
import {
  providerRequest, providerExtractText, DEFAULT_ENDPOINT, PROVIDER_LABEL,
  PROVIDER_KEY_NAME, ALL_PROVIDERS,
  type AnalystProvider, type AnalystPrompt,
} from "../ai/analyst";

export interface AnalystRun {
  ok: boolean;
  text?: string;
  /** Set when ok === false: a short, user-safe reason. */
  error?: string;
  /**
   * The status the relay should answer with, and 200 when ok. Always set, so the
   * route never has to invent a fallback. A wrong key or model name is the
   * caller's to fix and reports as 400; an upstream that is rate-limiting passes
   * 429 through so a client can back off; only a provider that was unreachable
   * or answered with nothing usable is a 502. Without this every failure looked
   * like a gateway fault in the browser console, including "you have not set a
   * key yet", which never contacted a gateway at all.
   */
  status: number;
}

/** What one provider can do right now, as the panel needs to render it. */
export interface ProviderStatus {
  id: AnalystProvider;
  label: string;
  /** True when this provider would run without any further setup. */
  ready: boolean;
  /** Where the cloud key came from. Always null for the keyless local provider. */
  keySource: KeySource;
  /** Models the local Ollama server actually has. Always empty for cloud. */
  models: string[];
  /** What is missing, in one sentence. Empty when ready. */
  hint: string;
}

export interface AnalystStatus {
  providers: ProviderStatus[];
  /** What the panel should select: the local server first, then any keyed cloud. */
  recommended: AnalystProvider | null;
  /** Whether the local Ollama server answered at all, which decides the local hint. */
  ollamaRunning: boolean;
}

// LLM generation is slow; give it far longer than an OSINT source call.
const ANALYST_TIMEOUT = 120_000;
// The readiness probe runs on panel open and must never make it feel slow. It
// only ever talks to the configured Ollama host, which is loopback by default.
const PROBE_TIMEOUT = 1500;

const ollamaBase = (): string =>
  (process.env.OLLAMA_HOST || DEFAULT_ENDPOINT.ollama).replace(/\/$/, "");

/**
 * Map a provider + the upstream's HTTP status to a short, user-safe message and
 * the status this relay should answer with. The two travel together because the
 * same fact decides both: whose problem it is. A key the operator can retype is
 * a 400 they can act on, not a 502 that reads as "this tool is broken".
 */
function analystError(
  provider: AnalystProvider,
  status: number,
  model: string,
): { error: string; status: number } {
  if (provider === "ollama") {
    // Ollama answers 404 for a model it does not have, which is a different
    // problem from a server that is not running and has a different fix.
    if (status === 404) {
      return {
        error: `Ollama is running but does not have the model "${model}". Pick one of its installed models in the panel, or pull this one first.`,
        status: 400,
      };
    }
    return { error: "Could not reach Ollama on this machine. Start it, then press Check again in the panel.", status: 502 };
  }
  if (status === 401 || status === 403) {
    return { error: "The provider rejected that API key. Check it in the panel and run again.", status: 400 };
  }
  // Gemini answers 400 for a bad key where the others answer 401, and 400 is
  // also what a wrong model name gets. Name both causes rather than guess one.
  if (status === 400) {
    return { error: "The provider rejected the request. Check the API key and the model name in the panel, then run again.", status: 400 };
  }
  // Pass the upstream's own 429 through so a caller backs off instead of
  // retrying into the same wall.
  if (status === 429) {
    return { error: "The provider is rate-limiting requests right now. Try again shortly.", status: 429 };
  }
  return { error: "The AI provider was unreachable or returned an error.", status: 502 };
}

interface OllamaTags {
  models?: { name?: string }[];
}

/** Ask the local Ollama server which models it has. Never throws. */
async function ollamaModels(): Promise<{ running: boolean; models: string[] }> {
  const r = await fetchJson<OllamaTags>(`${ollamaBase()}/api/tags`, {
    source: "analyst:ollama",
    timeoutMs: PROBE_TIMEOUT,
  });
  if (!r.ok || !r.data) return { running: false, models: [] };
  const models = (r.data.models ?? [])
    .map((m) => m.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  return { running: true, models };
}

/**
 * What the operator can run without leaving the panel. Cheap enough to call on
 * every panel open: one loopback probe plus one read of the key store.
 */
export async function analystStatus(): Promise<AnalystStatus> {
  const [local, configured] = await Promise.all([ollamaModels(), configuredMap()]);

  const providers: ProviderStatus[] = ALL_PROVIDERS.map((id) => {
    if (id === "ollama") {
      return {
        id,
        label: PROVIDER_LABEL[id],
        ready: local.running && local.models.length > 0,
        keySource: null,
        models: local.models,
        hint: !local.running
          ? "Ollama is not running on this machine."
          : local.models.length > 0
            ? ""
            : "Ollama is running but has no model installed yet.",
      };
    }
    const keySource = configured[PROVIDER_KEY_NAME[id]];
    return {
      id,
      label: PROVIDER_LABEL[id],
      ready: keySource !== null,
      keySource,
      models: [],
      hint: keySource !== null ? "" : "No API key saved for this provider yet.",
    };
  });

  // ALL_PROVIDERS is local-first, so the first ready entry is the local server
  // whenever it can run: the private option wins without a special case.
  return {
    providers,
    recommended: providers.find((p) => p.ready)?.id ?? null,
    ollamaRunning: local.running,
  };
}

/**
 * Run the analyst for one prompt. Never throws: a missing key, an unreachable
 * provider or an empty completion all come back as { ok:false, error }.
 *
 * A cloud key can arrive three ways: `browserKey`, pasted into the panel and sent
 * with this one request; a key saved to the store from that same panel; or the
 * matching environment variable. The one-shot paste wins, then the store, then
 * the environment, so an operator can try a key before saving it. However it
 * arrives, the key is used here and never persisted by this module or logged.
 */
export async function runAnalyst(
  provider: AnalystProvider,
  model: string,
  prompt: AnalystPrompt,
  browserKey?: string,
): Promise<AnalystRun> {
  let apiKey = "";
  if (provider !== "ollama") {
    const name = PROVIDER_KEY_NAME[provider];
    apiKey = (browserKey ?? "").trim() || (await resolveKey(name)) || "";
    if (!apiKey) {
      // Nothing was contacted, so this is not an upstream failure: it is a
      // precondition the operator fixes in the panel.
      return {
        ok: false,
        error: `No API key for ${PROVIDER_LABEL[provider]}. Paste one in the AI Analyst panel and press Save, or set ${name} on the server.`,
        status: 400,
      };
    }
  }

  const endpoint = provider === "ollama" ? ollamaBase() : DEFAULT_ENDPOINT[provider];
  const { url, init } = providerRequest(provider, model, endpoint, prompt, apiKey);

  const r = await fetchJson<unknown>(url, { source: `analyst:${provider}`, init, timeoutMs: ANALYST_TIMEOUT });
  if (!r.ok) return { ok: false, ...analystError(provider, r.status, model) };

  const text = providerExtractText(provider, r.data);
  // The provider answered, but with nothing we can use: a genuine bad gateway.
  if (!text.trim()) return { ok: false, error: "The model returned an empty response.", status: 502 };
  return { ok: true, text, status: 200 };
}
