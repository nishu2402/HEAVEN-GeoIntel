// ── Optional AI analyst — grounded LLM narration over the Phase 1 bundle ──────
//
// This is the pure half of Phase 3. It never talks to a model itself; it builds
// the prompt, shapes the provider request, and — crucially — validates whatever
// the model sends back. Every network detail lives server-side (src/lib/server/
// aiAnalyst.ts + the route) so the key never reaches the browser.
//
// The analyst is OFF by default and, when on, is held to the same rule as the
// rest of the AI layer: it may only reason over evidence the deterministic
// lookups already collected. Two mechanisms enforce that:
//
//   • the prompt hands the model ONLY the grounded bundle and forbids invention;
//   • parseAnalystResponse re-extracts every identifier the model wrote and flags
//     any that was not in the bundle as an UNVERIFIED claim, so a hallucinated
//     email or IP is surfaced as suspect rather than rendered as fact.
//
// No provider is assumed. The panel asks the server what is actually usable on
// this machine and selects that, preferring a local Ollama server because it is
// keyless and nothing leaves the box. A cloud provider is opt-in and, before it
// runs, the disclosure below states plainly that the bundle is transmitted
// off-box.

import type { AiAnalysis } from "./index";
import type { KeyName } from "../server/keyStore";
import { extractEntities } from "./textAnalysis";

export type AnalystProvider =
  | "ollama" | "openai" | "anthropic" | "gemini" | "groq" | "deepseek" | "mistral" | "openrouter";

/** Every provider except the local one, so key-only maps can be indexed safely. */
export type CloudProvider = Exclude<AnalystProvider, "ollama">;

/** Every provider, in the order the picker lists them (local first). */
export const ALL_PROVIDERS: readonly AnalystProvider[] = [
  "ollama", "openai", "anthropic", "gemini", "groq", "deepseek", "mistral", "openrouter",
];

/** Human label for the provider picker. */
export const PROVIDER_LABEL: Record<AnalystProvider, string> = {
  ollama: "Ollama (local)",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  gemini: "Google Gemini",
  groq: "Groq",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  openrouter: "OpenRouter",
};

export interface AnalystPrompt {
  system: string;
  user: string;
}

export interface AnalystResult {
  /** The model's narration, one line per non-empty output line. */
  narrative: string[];
  /**
   * Identifiers the model wrote that do NOT appear in the grounding bundle.
   * Rendered as suspect: the model may have invented them, so they must be
   * verified by a real lookup before they are trusted.
   */
  unverifiedClaims: string[];
}

export const DEFAULT_MODEL: Record<AnalystProvider, string> = {
  ollama: "llama3.2",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-3.6-flash",
  groq: "llama-3.3-70b-versatile",
  deepseek: "deepseek-chat",
  mistral: "mistral-small-latest",
  openrouter: "openai/gpt-4o-mini",
};

/**
 * The allow-listed key name each cloud provider reads, in the store and in the
 * environment. Typed as KeyName so a provider whose key was never added to the
 * store's allow-list fails to compile rather than failing to save at runtime.
 */
export const PROVIDER_KEY_NAME: Record<CloudProvider, KeyName> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/**
 * Providers that issue a working key on a free tier, so the setup card can lead
 * with one instead of sending an operator to a console that asks for a card.
 */
export const FREE_TIER: readonly CloudProvider[] = ["gemini", "groq"];

/** The provider the setup card opens on: a free key, one page, no card. */
export const SETUP_DEFAULT: CloudProvider = "gemini";

/** Where Ollama is downloaded, for the local path's single link. */
export const OLLAMA_INSTALL_URL = "https://ollama.com/download";

/**
 * Where an operator gets an API key for each cloud provider. These open the
 * provider's own key console, so the whole cloud path can be set up from the
 * panel without leaving the app: click through, create a key, paste it back.
 * Ollama is local and keyless, so it has no entry.
 */
export const API_KEY_URL: Record<CloudProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/app/apikey",
  groq: "https://console.groq.com/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  mistral: "https://console.mistral.ai/api-keys",
  openrouter: "https://openrouter.ai/keys",
};

export const DEFAULT_ENDPOINT: Record<AnalystProvider, string> = {
  ollama: "http://127.0.0.1:11434",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/**
 * Suggested models per provider, and the fallback the picker shows when the
 * provider has not been asked what it offers. Advisory only: the "Custom model"
 * field always accepts anything, so a release the operator has access to is
 * never blocked by this list. The first entry of each is the DEFAULT_MODEL
 * above. Ollama lists common local pulls, not an installed set.
 *
 * A hand-written list goes stale, and a stale list reads to the operator as a
 * broken tool: Gemini retired the 1.5 models outright and now refuses 2.5 to new
 * keys, so the default here answered every run with a 404. That is why the panel
 * prefers the live list from listModels() and keeps this only as the fallback.
 *
 * Each Gemini entry was run against the relay before being listed, and they are
 * ordered by what answered rather than by what is newest: the free tier returns
 * 503 for the newest flash and 429 for pro, and even the rolling flash alias
 * refused one call in two. The first entry is the default, so it is the one
 * measured to answer every time.
 */
export const MODEL_CATALOG: Record<AnalystProvider, string[]> = {
  ollama: ["llama3.2", "llama3.1", "llama3.3", "qwen2.5", "gemma2", "gemma3", "phi3.5", "mistral", "deepseek-r1"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini", "o3-mini"],
  anthropic: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-3-7-sonnet-latest", "claude-sonnet-4-latest"],
  gemini: ["gemini-3.6-flash", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-pro-latest"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it", "deepseek-r1-distill-llama-70b"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  mistral: ["mistral-small-latest", "mistral-large-latest", "open-mistral-nemo", "codestral-latest"],
  openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-001", "meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-chat"],
};

/**
 * Gemini's output budget, which its reasoning is drawn from before any of the
 * answer is written. Measured against a real evidence bundle: about 1,100
 * tokens of thinking plus 130 of answer, so this leaves better than double the
 * headroom. See providerRequest.
 */
export const GEMINI_OUTPUT_TOKENS = 3000;

/**
 * The longest model list the picker will show. OpenRouter alone publishes
 * several hundred, which is a dropdown nobody can use; the catalog-first
 * ordering in orderModels() means the cut only ever falls on the tail.
 */
export const MAX_LISTED_MODELS = 50;

// ── Prompt construction ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You are a defensive OSINT analyst. You are given a structured evidence bundle",
  "that deterministic lookups already collected about one subject. Write a short,",
  "plain-language assessment for another analyst.",
  "",
  "Hard rules:",
  "- Use ONLY the evidence in the bundle. Do not invent identifiers, numbers,",
  "  names, breaches, dates or facts that are not present.",
  "- Do not speculate about the subject's identity or intent beyond what the",
  "  evidence supports. If the evidence is thin, say so.",
  "- Prefer three to six sentences. No preamble, no sign-off, no markdown.",
].join("\n");

/**
 * Build the grounded prompt. The user message is a deterministic serialisation
 * of the bundle, so the same analysis always yields the same prompt.
 */
export function buildAnalystPrompt(a: AiAnalysis): AnalystPrompt {
  const lines: string[] = [
    `Subject: ${a.subject} (kind: ${a.kind})`,
    `Risk score: ${a.risk.score}/100 (${a.risk.band}), confidence ${a.risk.confidence}.`,
    `Model rationale: ${a.risk.rationale}`,
  ];

  if (a.risk.factors.length > 0) {
    lines.push("", "Contributing factors:");
    for (const f of a.risk.factors) {
      lines.push(`- ${f.label} (${Math.round(f.share * 100)}% of score): ${f.evidence}`);
    }
  } else {
    lines.push("", "No positive-risk factors were found.");
  }

  if (a.anomalies.length > 0) {
    lines.push("", "Flagged patterns:");
    for (const an of a.anomalies) lines.push(`- ${an.title} (${an.severity}): ${an.detail}`);
  }

  lines.push("", "Write the assessment now, grounded strictly in the above.");
  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

// ── Model discovery ──────────────────────────────────────────────────────────
//
// Every cloud provider publishes what its keys may call, and asking beats
// guessing: the shipped catalog above is a snapshot that goes stale the moment a
// provider retires a name, and the operator is the one who then sees a 404.

/** A model id that names a family which cannot answer a text prompt. */
const NON_CHAT = /embed|tts|whisper|speech|transcribe|audio|dall-e|imagen|image|veo|lyria|banana|moderation|rerank|guard|robotics|computer-use|aqa/i;

interface GeminiModel {
  name?: string;
  supportedGenerationMethods?: string[];
}
interface OpenAiModel {
  id?: string;
}

/**
 * Ask a provider which models this key may call. Same auth as a completion, so
 * a key that lists is a key that runs; a key that cannot list is reported and
 * the picker falls back to the catalog.
 */
export function modelsRequest(provider: CloudProvider, endpoint: string, apiKey: string): ProviderRequest {
  const base = endpoint.replace(/\/$/, "");
  if (provider === "gemini") {
    // pageSize because the default page is 50 and the tail is paginated behind a
    // token; one page of 200 covers every published model with room to spare.
    return {
      url: `${base}/models?pageSize=200`,
      init: { method: "GET", headers: { "x-goog-api-key": apiKey } },
    };
  }
  if (provider === "anthropic") {
    return {
      url: `${base}/models?limit=100`,
      init: { method: "GET", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } },
    };
  }
  return { url: `${base}/models`, init: { method: "GET", headers: { authorization: `Bearer ${apiKey}` } } };
}

/**
 * Pull the usable text models out of a provider's model list. Anything that
 * names a non-text family (embeddings, speech, image generation) is dropped: it
 * would only ever answer this prompt with an error. The filter is advisory in
 * the same way the catalog is, because the custom-model field bypasses both.
 */
export function parseModelList(provider: CloudProvider, json: unknown): string[] {
  const j = json as { models?: GeminiModel[]; data?: OpenAiModel[] } | undefined;
  const ids = provider === "gemini"
    ? (j?.models ?? [])
        // A Gemini model that cannot generateContent is an embedding or a tuner
        // endpoint; it is listed all the same.
        .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m) => (m.name ?? "").replace(/^models\//, ""))
    : (j?.data ?? []).map((m) => m.id ?? "");
  return ids.filter((id) => id !== "" && !NON_CHAT.test(id));
}

/**
 * Order a live list so the picker's first entry is the one to run: the shipped
 * catalog's order first (those are the vetted defaults), then whatever else the
 * key can call, in the provider's own order. Trimmed to MAX_LISTED_MODELS.
 */
export function orderModels(provider: CloudProvider, live: readonly string[]): string[] {
  const preferred = MODEL_CATALOG[provider];
  const known = preferred.filter((m) => live.includes(m));
  const rest = live.filter((m) => !preferred.includes(m));
  return [...known, ...rest].slice(0, MAX_LISTED_MODELS);
}

// ── Failure reporting ────────────────────────────────────────────────────────

/** Collapse a provider's message to one short line fit for a panel. */
function oneLine(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 200 ? `${t.slice(0, 199)}…` : t;
}

/**
 * The provider's own explanation for a rejected request, or "" when it did not
 * give one. Worth surfacing verbatim: Google answers a retired model with the
 * name of the model that replaced it, which is the whole fix in one sentence,
 * and the relay used to throw it away and report "unreachable or returned an
 * error" instead.
 */
export function providerErrorMessage(json: unknown): string {
  const j = json as { error?: unknown; message?: unknown } | undefined;
  // Ollama states it flat: { error: "model 'x' not found" }.
  if (typeof j?.error === "string") return oneLine(j.error);
  // Gemini, OpenAI, Anthropic and the OpenAI-compatible providers nest it.
  const nested = (j?.error as { message?: unknown } | undefined)?.message;
  if (typeof nested === "string") return oneLine(nested);
  // Mistral reports a malformed body at the top level.
  if (typeof j?.message === "string") return oneLine(j.message);
  return "";
}

interface GeminiCandidate {
  content?: { parts?: { text?: string; thought?: boolean }[] };
  finishReason?: string;
}

const TOKEN_CEILING =
  "The model spent its whole output budget before writing an answer. Pick a smaller reasoning model, or run this on a subject with a shorter evidence bundle.";

/**
 * Why a 200 carried no answer. A provider that stops at its token ceiling has
 * not failed in any way the operator can see, so "the model returned an empty
 * response" sends them to look for a fault that is not there; the cause is the
 * budget, and it has a different fix from a blocked prompt.
 */
export function providerEmptyReason(provider: AnalystProvider, json: unknown): string {
  const j = json as {
    candidates?: GeminiCandidate[];
    promptFeedback?: { blockReason?: string };
    stop_reason?: string;
    choices?: { finish_reason?: string }[];
  } | undefined;

  if (provider === "gemini") {
    const blocked = j?.promptFeedback?.blockReason;
    if (blocked) return `Google's safety filter blocked the prompt (${blocked}).`;
    if (j?.candidates?.[0]?.finishReason === "MAX_TOKENS") return TOKEN_CEILING;
    return "";
  }
  if (provider === "anthropic") return j?.stop_reason === "max_tokens" ? TOKEN_CEILING : "";
  if (provider === "ollama") return "";
  return j?.choices?.[0]?.finish_reason === "length" ? TOKEN_CEILING : "";
}

/** Replace a secret with a placeholder wherever it appears in text. */
export function redact(text: string, secret: string): string {
  return secret === "" ? text : text.split(secret).join("[key]");
}

// ── Response validation ──────────────────────────────────────────────────────

/** Every identifier that appears anywhere in the grounding bundle. */
function groundedIdentifiers(a: AiAnalysis): Set<string> {
  const corpus = [
    a.subject,
    a.risk.rationale,
    ...a.risk.factors.flatMap((f) => [f.label, f.evidence]),
    ...a.anomalies.flatMap((an) => [an.title, an.detail]),
    ...a.summary,
  ].join("\n");
  return new Set(extractEntities(corpus).map((e) => `${e.kind}:${e.value.toLowerCase()}`));
}

/**
 * Turn raw model text into a narrative plus the list of identifiers it asserted
 * that were NOT in the bundle. The identifier extraction reuses the same
 * shape-checked extractor the rest of the app trusts, so "unverified" means the
 * model produced a well-formed identifier that the evidence never contained.
 */
export function parseAnalystResponse(text: string, a: AiAnalysis): AnalystResult {
  const narrative = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  const grounded = groundedIdentifiers(a);
  const seen = new Set<string>();
  const unverifiedClaims: string[] = [];
  for (const e of extractEntities(text)) {
    const key = `${e.kind}:${e.value.toLowerCase()}`;
    if (grounded.has(key) || seen.has(key)) continue;
    seen.add(key);
    unverifiedClaims.push(`${e.kind} ${e.value}`);
  }

  return { narrative, unverifiedClaims };
}

// ── Opsec disclosure ─────────────────────────────────────────────────────────

/** The provider's name as it reads in the disclosure sentence (no parenthetical). */
const API_NAME: Record<CloudProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  groq: "Groq",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  openrouter: "OpenRouter",
};

/** What running the analyst on this provider discloses, stated plainly. */
export function analystDisclosure(provider: AnalystProvider): string {
  if (provider === "ollama") {
    return "The evidence bundle is sent to your local Ollama server only. Nothing leaves this machine.";
  }
  return `The evidence bundle is sent to ${API_NAME[provider]}'s API through your own server relay, using the key you paste or save in the panel, or one set on the server. This is the only feature that transmits a subject's data off this machine; it is off unless you enable it.`;
}

// ── Provider request shaping (pure; the key is injected by the server) ────────

export interface ProviderRequest {
  url: string;
  init: RequestInit;
}

/**
 * Build the HTTP request for a provider. Pure: given the same config, prompt and
 * key it always produces the same request. The server supplies `apiKey` from its
 * environment (empty for Ollama), so no key is ever constructed in the browser.
 */
export function providerRequest(
  provider: AnalystProvider,
  model: string,
  endpoint: string,
  prompt: AnalystPrompt,
  apiKey: string,
): ProviderRequest {
  const base = endpoint.replace(/\/$/, "");
  if (provider === "ollama") {
    return {
      url: `${base}/api/chat`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        }),
      },
    };
  }
  if (provider === "anthropic") {
    return {
      url: `${base}/messages`,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 600,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
        }),
      },
    };
  }
  if (provider === "gemini") {
    // Google's Generative Language API: model in the path, key in a header (never
    // the URL), system prompt in its own field. Response shape differs too — see
    // providerExtractText.
    //
    // maxOutputTokens has to cover the model's own reasoning, not just the
    // answer. On Gemini 3.x a six-sentence brief over a real evidence bundle
    // spends around 1,100 tokens thinking before it writes a word, so the 800
    // this used to send came back truncated mid-sentence (finishReason
    // MAX_TOKENS) or, on a longer bundle, with no text at all. thinkingLevel
    // would cap the reasoning directly but is rejected outright by models that
    // do not think, which the custom-model field lets an operator pick.
    //
    // The model is the one part of the path the caller chooses, so it is
    // encoded: raw, "../../x?y=" walked the request (and the key header with it)
    // to any other path on Google's API. A pasted "models/" prefix is dropped,
    // since the path already has one.
    return {
      url: `${base}/models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: "user", parts: [{ text: prompt.user }] }],
          generationConfig: { maxOutputTokens: GEMINI_OUTPUT_TOKENS },
        }),
      },
    };
  }
  // openai / groq / deepseek / mistral / openrouter — one OpenAI-compatible Chat
  // Completions shape: same body, same Bearer auth, differing only in base URL,
  // key and model (all injected by the server relay).
  return {
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
    },
  };
}

/** Pull the completion text out of a provider's response JSON, or "" if absent. */
export function providerExtractText(provider: AnalystProvider, json: unknown): string {
  const j = json as Record<string, unknown>;
  if (provider === "ollama") {
    const message = j?.message as { content?: string } | undefined;
    return message?.content ?? "";
  }
  if (provider === "anthropic") {
    const content = j?.content as { text?: string }[] | undefined;
    return content?.[0]?.text ?? "";
  }
  if (provider === "gemini") {
    const candidates = j?.candidates as GeminiCandidate[] | undefined;
    const parts = candidates?.[0]?.content?.parts ?? [];
    // Every text part, joined: a thinking model splits its answer across parts
    // and puts its reasoning in parts of its own, which carry thought: true and
    // are not the answer. Reading parts[0] alone returned a fragment when the
    // answer was split, and the raw reasoning when a thought came first.
    return parts.filter((p) => p.thought !== true).map((p) => p.text ?? "").join("");
  }
  // openai / groq / deepseek / mistral / openrouter — identical Chat Completions shape.
  const choices = j?.choices as { message?: { content?: string } }[] | undefined;
  return choices?.[0]?.message?.content ?? "";
}
