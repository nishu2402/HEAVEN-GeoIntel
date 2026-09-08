import { describe, it, expect } from "vitest";
import {
  buildAnalystPrompt, parseAnalystResponse, analystDisclosure,
  providerRequest, providerExtractText, DEFAULT_ENDPOINT,
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

  it("tells the cloud disclosure the key can be pasted in the panel", () => {
    expect(analystDisclosure("openai")).toMatch(/paste in the panel/i);
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
