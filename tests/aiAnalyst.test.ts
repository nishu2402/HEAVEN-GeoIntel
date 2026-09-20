import { describe, it, expect } from "vitest";
import {
  buildAnalystPrompt, parseAnalystResponse, analystDisclosure,
  providerRequest, providerExtractText, providerErrorMessage, providerEmptyReason,
  modelsRequest, parseModelList, orderModels, redact,
  DEFAULT_ENDPOINT, DEFAULT_MODEL, MODEL_CATALOG, GEMINI_OUTPUT_TOKENS, MAX_LISTED_MODELS,
  API_KEY_URL, ALL_PROVIDERS,
} from "@/lib/ai/analyst";
import type { AiAnalysis } from "@/lib/ai";

// The pure analyst layer: prompt construction, response validation, the opsec
// disclosure and per-provider request shaping. No network here.

const rich = {
  kind: "email",
  subject: "victim@example.com",
  signals: [],
  risk: {
    score: 62, band: "high", confidence: "high",
    rationale: "Elevated by leaked credentials.",
    factors: [
      { label: "Password exposed", share: 0.6, evidence: "3 breaches exposed a password" },
      { label: "Reuse likely", share: 0.4, evidence: "few distinct passwords" },
    ],
  },
  anomalies: [
    { id: "a1", title: "Reused password also breached", severity: "high", detail: "the same password recurs" },
  ],
  summary: ["victim@example.com scores 62 out of 100.", "The score rests on 2 signals."],
} as unknown as AiAnalysis;

const clean = {
  kind: "hash",
  subject: "deadbeef",
  signals: [],
  risk: { score: 4, band: "minimal", confidence: "low", rationale: "No elevated signals.", factors: [] },
  anomalies: [],
  summary: ["No elevated-risk signals were found for deadbeef."],
} as unknown as AiAnalysis;

describe("buildAnalystPrompt", () => {
  it("serialises factors and anomalies into a grounded prompt", () => {
    const { system, user } = buildAnalystPrompt(rich);
    expect(system).toContain("Use ONLY the evidence");
    expect(user).toContain("Subject: victim@example.com (kind: email)");
    expect(user).toContain("Contributing factors:");
    expect(user).toContain("Password exposed (60% of score): 3 breaches exposed a password");
    expect(user).toContain("Flagged patterns:");
    expect(user).toContain("Reused password also breached (high)");
  });

  it("states plainly when there are no factors and no anomalies", () => {
    const { user } = buildAnalystPrompt(clean);
    expect(user).toContain("No positive-risk factors were found.");
    expect(user).not.toContain("Flagged patterns:");
  });
});

describe("parseAnalystResponse", () => {
  it("keeps non-empty lines and flags identifiers absent from the bundle", () => {
    const text = [
      "The subject victim@example.com is high risk.",
      "",
      "A message to attacker@evil.com was seen.",
      "Also 8.8.8.8 and 8.8.8.8 recur.",
    ].join("\n");
    const { narrative, unverifiedClaims } = parseAnalystResponse(text, rich);
    expect(narrative).toHaveLength(3); // the blank line is dropped
    // victim@example.com is grounded (it is the subject) → not flagged.
    // attacker@evil.com and 8.8.8.8 are not in the bundle → flagged, deduped.
    expect(unverifiedClaims).toEqual(["email attacker@evil.com", "ip 8.8.8.8"]);
  });

  it("returns an empty narrative for empty text", () => {
    expect(parseAnalystResponse("   \n  ", rich)).toEqual({ narrative: [], unverifiedClaims: [] });
  });
});

describe("analystDisclosure", () => {
  it("says local for Ollama and off-box for a cloud provider", () => {
    expect(analystDisclosure("ollama")).toContain("Nothing leaves this machine");
    expect(analystDisclosure("openai")).toContain("OpenAI");
    expect(analystDisclosure("anthropic")).toContain("Anthropic");
  });

  it("names every cloud provider in its disclosure", () => {
    expect(analystDisclosure("gemini")).toContain("Google Gemini");
    expect(analystDisclosure("groq")).toContain("Groq");
    expect(analystDisclosure("deepseek")).toContain("DeepSeek");
    expect(analystDisclosure("mistral")).toContain("Mistral");
    expect(analystDisclosure("openrouter")).toContain("OpenRouter");
  });

  it("tells the cloud disclosure the key can be pasted or saved in the panel", () => {
    expect(analystDisclosure("openai")).toMatch(/paste or save in the panel/i);
  });
});

describe("API_KEY_URL", () => {
  it("gives every cloud provider an https key console", () => {
    for (const p of ALL_PROVIDERS) {
      if (p === "ollama") continue; // local, keyless — no console
      expect(API_KEY_URL[p], `${p} has no key URL`).toMatch(/^https:\/\//);
    }
  });

  it("points at each provider's real key page", () => {
    expect(API_KEY_URL.openai).toBe("https://platform.openai.com/api-keys");
    expect(API_KEY_URL.anthropic).toBe("https://console.anthropic.com/settings/keys");
    expect(API_KEY_URL.openrouter).toBe("https://openrouter.ai/keys");
  });
});

describe("providerRequest", () => {
  const prompt = { system: "SYS", user: "USR" };

  it("shapes an Ollama chat request with no auth header", () => {
    const { url, init } = providerRequest("ollama", "llama3.2", DEFAULT_ENDPOINT.ollama, prompt, "");
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(body.stream).toBe(false);
  });

  it("shapes an OpenAI request with a bearer key and strips a trailing slash", () => {
    const { url, init } = providerRequest("openai", "gpt-4o-mini", "https://api.openai.com/v1/", prompt, "KEY123");
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer KEY123");
  });

  it("shapes an Anthropic request with the x-api-key and version headers", () => {
    const { url, init } = providerRequest("anthropic", "claude-3-5-haiku-latest", DEFAULT_ENDPOINT.anthropic, prompt, "KEY456");
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("KEY456");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe("SYS");
    expect(body.messages).toEqual([{ role: "user", content: "USR" }]);
  });

  it("shapes a Gemini request with the model in the path and the key in a header", () => {
    const { url, init } = providerRequest("gemini", "gemini-1.5-flash", DEFAULT_ENDPOINT.gemini, prompt, "GKEY");
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("GKEY");
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.system_instruction.parts[0].text).toBe("SYS");
    expect(body.contents[0].parts[0].text).toBe("USR");
  });

  it("keeps a Gemini model name inside its own path segment", () => {
    // The model is caller-chosen text in the URL path, next to the key header.
    const walk = providerRequest("gemini", "../../../v1/files?pageSize=1#", DEFAULT_ENDPOINT.gemini, prompt, "GKEY").url;
    const u = new URL(walk);
    expect(u.origin + u.pathname).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/..%2F..%2F..%2Fv1%2Ffiles%3FpageSize%3D1%23:generateContent",
    );
    expect(u.search).toBe("");
    // A pasted "models/" prefix is the same model, not a second path level.
    expect(providerRequest("gemini", "models/gemini-2.5-flash", DEFAULT_ENDPOINT.gemini, prompt, "GKEY").url)
      .toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  });

  it("shapes every OpenAI-compatible provider as a chat/completions call", () => {
    for (const p of ["groq", "deepseek", "mistral", "openrouter"] as const) {
      const { url, init } = providerRequest(p, "m", DEFAULT_ENDPOINT[p], prompt, "K");
      expect(url).toBe(`${DEFAULT_ENDPOINT[p]}/chat/completions`);
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer K");
    }
  });
});

describe("providerExtractText", () => {
  it("pulls the completion out of each provider's shape", () => {
    expect(providerExtractText("ollama", { message: { content: "A" } })).toBe("A");
    expect(providerExtractText("openai", { choices: [{ message: { content: "B" } }] })).toBe("B");
    expect(providerExtractText("anthropic", { content: [{ text: "C" }] })).toBe("C");
    expect(providerExtractText("gemini", { candidates: [{ content: { parts: [{ text: "D" }] } }] })).toBe("D");
    expect(providerExtractText("groq", { choices: [{ message: { content: "E" } }] })).toBe("E");
  });

  it("returns empty string when the shape is missing", () => {
    expect(providerExtractText("ollama", {})).toBe("");
    expect(providerExtractText("openai", {})).toBe("");
    expect(providerExtractText("anthropic", {})).toBe("");
    expect(providerExtractText("gemini", {})).toBe("");
  });
});

// ── The Gemini failure that started this ─────────────────────────────────────
// The shipped default was a model Google had retired, so every run 404'd and the
// panel reported it as an unreachable gateway. These pin the three things that
// together make that impossible to repeat: a default that was actually run, an
// output budget that covers a thinking model, and a list asked of the provider.

describe("the Gemini request", () => {
  const prompt = { system: "S", user: "U" };

  it("names no model Google has withdrawn, and defaults to the head of its own catalog", () => {
    expect(MODEL_CATALOG.gemini[0]).toBe(DEFAULT_MODEL.gemini);
    // 1.5 was removed outright and 2.5 is refused to new keys. Neither may be
    // offered: an operator who picks one gets a 404 and no way to tell why.
    for (const m of MODEL_CATALOG.gemini) expect(m).not.toMatch(/^gemini-[12]\./);
  });

  it("asks for an output budget its reasoning can fit inside", () => {
    const { init } = providerRequest("gemini", "gemini-3.6-flash", DEFAULT_ENDPOINT.gemini, prompt, "K");
    const body = JSON.parse(String(init.body)) as { generationConfig: { maxOutputTokens: number } };
    expect(body.generationConfig.maxOutputTokens).toBe(GEMINI_OUTPUT_TOKENS);
    // Measured: a real bundle spends about 1,100 tokens thinking before the
    // first word of the answer, and the old 800 came back truncated.
    expect(GEMINI_OUTPUT_TOKENS).toBeGreaterThan(1500);
  });

  it("reads every answer part and never reads the reasoning out as the answer", () => {
    const json = {
      candidates: [{ content: { parts: [
        { text: "reasoning nobody asked for", thought: true },
        // A part can carry a signature and no text at all.
        { thoughtSignature: "EuwR" },
        { text: "The subject " },
        { text: "scores 62." },
      ] } }],
    };
    expect(providerExtractText("gemini", json)).toBe("The subject scores 62.");
  });
});

describe("providerErrorMessage", () => {
  it("reads each provider's own explanation out of its refusal", () => {
    // Gemini, OpenAI and Anthropic nest it; Ollama states it flat; Mistral puts
    // a malformed body at the top level.
    expect(providerErrorMessage({ error: { message: "models/x is not found" } })).toBe("models/x is not found");
    expect(providerErrorMessage({ error: "model 'y' not found" })).toBe("model 'y' not found");
    expect(providerErrorMessage({ message: "Invalid model" })).toBe("Invalid model");
  });

  it("says nothing when the provider did not", () => {
    expect(providerErrorMessage({})).toBe("");
    expect(providerErrorMessage(undefined)).toBe("");
    expect(providerErrorMessage({ error: { code: 404 } })).toBe("");
  });

  it("flattens a message onto one line and caps its length", () => {
    expect(providerErrorMessage({ error: { message: " two\n  lines " } })).toBe("two lines");
    const long = providerErrorMessage({ error: { message: "x".repeat(400) } });
    expect(long).toHaveLength(200);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("providerEmptyReason", () => {
  const ceiling = /spent its whole output budget/;

  it("names the token ceiling rather than calling the answer empty", () => {
    expect(providerEmptyReason("gemini", { candidates: [{ finishReason: "MAX_TOKENS" }] })).toMatch(ceiling);
    expect(providerEmptyReason("anthropic", { stop_reason: "max_tokens" })).toMatch(ceiling);
    expect(providerEmptyReason("openai", { choices: [{ finish_reason: "length" }] })).toMatch(ceiling);
  });

  it("names a blocked prompt as the filter it was", () => {
    expect(providerEmptyReason("gemini", { promptFeedback: { blockReason: "SAFETY" } })).toMatch(/safety filter blocked the prompt \(SAFETY\)/);
  });

  it("offers no reason when the provider gave none", () => {
    expect(providerEmptyReason("gemini", { candidates: [{ finishReason: "STOP" }] })).toBe("");
    expect(providerEmptyReason("anthropic", { stop_reason: "end_turn" })).toBe("");
    expect(providerEmptyReason("openai", {})).toBe("");
    // Ollama reports no finish reason at all, so there is nothing to read.
    expect(providerEmptyReason("ollama", { done_reason: "stop" })).toBe("");
  });
});

describe("model discovery", () => {
  it("asks each provider for its list with the same auth a completion uses", () => {
    const gem = modelsRequest("gemini", DEFAULT_ENDPOINT.gemini, "K");
    expect(gem.url).toBe(`${DEFAULT_ENDPOINT.gemini}/models?pageSize=200`);
    expect((gem.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("K");

    const ant = modelsRequest("anthropic", `${DEFAULT_ENDPOINT.anthropic}/`, "K");
    expect(ant.url).toBe(`${DEFAULT_ENDPOINT.anthropic}/models?limit=100`);
    expect((ant.init.headers as Record<string, string>)["x-api-key"]).toBe("K");

    const oai = modelsRequest("openai", DEFAULT_ENDPOINT.openai, "K");
    expect(oai.url).toBe(`${DEFAULT_ENDPOINT.openai}/models`);
    expect((oai.init.headers as Record<string, string>).authorization).toBe("Bearer K");
  });

  it("keeps the Gemini models that can answer a prompt and drops the rest", () => {
    const models = parseModelList("gemini", {
      models: [
        { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
        // Listed, but it answers embeddings, not prompts.
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
        // Answers generateContent, but only ever with an image or speech.
        { name: "models/gemini-3-pro-image", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
        // Malformed entries must not become empty options in the dropdown.
        { supportedGenerationMethods: ["generateContent"] },
        { name: "models/no-methods-listed" },
      ],
    });
    expect(models).toEqual(["gemini-3.6-flash"]);
  });

  it("reads the OpenAI-compatible list shape, and an absent one as empty", () => {
    expect(parseModelList("openai", { data: [{ id: "gpt-5" }, { id: "whisper-1" }, {}] })).toEqual(["gpt-5"]);
    expect(parseModelList("openai", {})).toEqual([]);
    expect(parseModelList("gemini", undefined)).toEqual([]);
  });

  it("leads with the vetted catalog, keeps the rest, and caps the list", () => {
    const live = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-3.6-flash", "some-new-model"];
    // The catalog's order wins for the models it names, because the first entry
    // is what the panel runs; anything else follows in the provider's order.
    expect(orderModels("gemini", live)).toEqual([
      "gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-flash", "some-new-model",
    ]);
    const many = Array.from({ length: MAX_LISTED_MODELS + 20 }, (_, i) => `m${i}`);
    expect(orderModels("openrouter", many)).toHaveLength(MAX_LISTED_MODELS);
  });
});

describe("redact", () => {
  it("removes the key from anything the provider echoed back", () => {
    expect(redact("key sk-secret is invalid", "sk-secret")).toBe("key [key] is invalid");
    expect(redact("nothing to hide", "")).toBe("nothing to hide");
  });
});
