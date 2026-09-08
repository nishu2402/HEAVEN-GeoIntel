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
// Ollama is the default provider: local, keyless, nothing leaves the machine. A
// cloud provider is opt-in and, before it runs, the disclosure below states
// plainly that the bundle is transmitted off-box.

import type { AiAnalysis } from "./index";
import { extractEntities } from "./textAnalysis";

export type AnalystProvider =
  | "ollama" | "openai" | "anthropic" | "gemini" | "groq" | "deepseek" | "mistral" | "openrouter";

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
  gemini: "gemini-1.5-flash",
  groq: "llama-3.3-70b-versatile",
  deepseek: "deepseek-chat",
  mistral: "mistral-small-latest",
  openrouter: "openai/gpt-4o-mini",
};

/**
 * Where an operator gets an API key for each cloud provider. These open the
 * provider's own key console, so the whole cloud path can be set up from the
 * panel without leaving the app: click through, create a key, paste it back.
 * Ollama is local and keyless, so it has no entry.
 */
export const API_KEY_URL: Record<Exclude<AnalystProvider, "ollama">, string> = {
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
 * Suggested models per provider for the picker's dropdown. Advisory only: the
 * "Custom model" field always accepts anything, so a new release the operator
 * has access to is never blocked by this list. The first entry of each is the
 * DEFAULT_MODEL above. Ollama lists common local pulls, not an installed set.
 */
export const MODEL_CATALOG: Record<AnalystProvider, string[]> = {
  ollama: ["llama3.2", "llama3.1", "llama3.3", "qwen2.5", "gemma2", "gemma3", "phi3.5", "mistral", "deepseek-r1"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini", "o3-mini"],
  anthropic: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-3-7-sonnet-latest", "claude-sonnet-4-latest"],
  gemini: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it", "deepseek-r1-distill-llama-70b"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  mistral: ["mistral-small-latest", "mistral-large-latest", "open-mistral-nemo", "codestral-latest"],
  openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-001", "meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-chat"],
};

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
const API_NAME: Record<Exclude<AnalystProvider, "ollama">, string> = {
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
  return `The evidence bundle is sent to ${API_NAME[provider]}'s API through your own server relay, using the key you paste in the panel or one set on the server. This is the only feature that transmits a subject's data off this machine; it is off unless you enable it.`;
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
    return {
      url: `${base}/models/${model}:generateContent`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: "user", parts: [{ text: prompt.user }] }],
          generationConfig: { maxOutputTokens: 800 },
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
    const candidates = j?.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined;
    return candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
  // openai / groq / deepseek / mistral / openrouter — identical Chat Completions shape.
  const choices = j?.choices as { message?: { content?: string } }[] | undefined;
  return choices?.[0]?.message?.content ?? "";
}
