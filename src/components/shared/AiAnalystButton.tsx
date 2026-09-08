"use client";

import { useState } from "react";
import { Bot, AlertTriangle, Loader2, Terminal, KeyRound, Eye, EyeOff, ExternalLink } from "lucide-react";
import { postLookup } from "@/lib/client/postLookup";
import type { AiAnalysis } from "@/lib/ai";
import {
  buildAnalystPrompt, parseAnalystResponse, analystDisclosure,
  DEFAULT_MODEL, MODEL_CATALOG, ALL_PROVIDERS, PROVIDER_LABEL, API_KEY_URL,
  type AnalystProvider, type AnalystResult,
} from "@/lib/ai/analyst";

/**
 * AI ANALYST — the optional, opt-in language-model narration (Phase 3).
 *
 * It is off until the analyst presses run. The prompt is built from the grounded
 * bundle already on screen, sent through the server relay to the chosen provider
 * (local Ollama by default, so nothing leaves the machine), and the reply is
 * re-validated: any identifier the model wrote that was not in the evidence is
 * shown as UNVERIFIED, never as fact. The disclosure states, before the first
 * run, exactly what a cloud provider would transmit off-box.
 *
 * A cloud provider needs a key. Rather than force the operator out to a terminal
 * to edit the environment, the key is entered right here: a "Get a key" link
 * opens the provider's console and the field takes the paste. The key is held in
 * this tab for the session only, never written to disk, and rides solely in the
 * request body to our own relay, which forwards it and never stores or logs it.
 */

type Status = "idle" | "loading" | "done" | "error";

// Sentinel value for the model dropdown's "type my own" row.
const CUSTOM = "__custom__";

// A cloud key is held only in React state for the life of the tab. It is
// deliberately NOT written to localStorage or any other persistent store: an API
// key is a secret, and clear-text storage in the browser is a liability that
// outweighs saving one paste. It leaves the machine only in the request the
// operator triggers.
type CloudProvider = Exclude<AnalystProvider, "ollama">;

export default function AiAnalystButton({ analysis }: { analysis: AiAnalysis }) {
  const [provider, setProvider] = useState<AnalystProvider>("ollama");
  const [model, setModel] = useState<string>(DEFAULT_MODEL.ollama);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalystResult | null>(null);
  const [error, setError] = useState("");

  // Null for the local, keyless Ollama; the narrowed provider otherwise, so the
  // key-only maps (API_KEY_URL, PROVIDER_LABEL) can be indexed safely.
  const cloud: CloudProvider | null = provider === "ollama" ? null : provider;

  const catalog = MODEL_CATALOG[provider];
  // Whether the current model is one of the suggestions (drives the dropdown vs.
  // the free-text "Custom" box). An empty model is treated as custom-in-progress.
  const isCustom = model === "" || !catalog.includes(model);

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setError("");
  };

  const onProvider = (p: AnalystProvider) => {
    setProvider(p);
    setModel(DEFAULT_MODEL[p]);
    setShowKey(false);
    // The key is per-session and lives only in state; switching providers clears
    // it so one provider's key is never carried to another.
    setApiKey("");
    reset();
  };

  const onModelSelect = (v: string) => {
    // Picking "Custom" while already on a suggestion blanks the box so the
    // operator can type; picking it again while custom keeps what they have.
    setModel(v === CUSTOM ? (isCustom ? model : "") : v);
    reset();
  };

  const onKeyChange = (v: string) => {
    setApiKey(v);
    reset();
  };

  const run = async () => {
    setStatus("loading");
    setResult(null);
    setError("");
    const { system, user } = buildAnalystPrompt(analysis);
    const key = apiKey.trim();
    const body: Record<string, unknown> = { provider, model, system, user };
    // Send the pasted key only for a cloud provider that has one; Ollama needs
    // none, and an empty field falls back to any key set on the server.
    if (cloud && key) body.apiKey = key;
    const out = await postLookup<{ text: string }>("/api/ai-analyst", body);
    if (!out.ok) {
      setError(out.error);
      setStatus("error");
      return;
    }
    setResult(parseAnalystResponse(out.data.text, analysis));
    setStatus("done");
  };

  const control = "bg-[var(--hv-glass)] border border-[var(--hv-glass-border)] rounded text-[var(--hv-ink)] font-mono";
  const link = "inline-flex items-center gap-1 text-[var(--hv-cyan)] hover:underline";

  return (
    <div className="space-y-2 border-t border-[var(--hv-glass-border)] pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5" /> AI Analyst (optional)
        </div>
        <select
          aria-label="Analyst provider"
          value={provider}
          onChange={(e) => onProvider(e.target.value as AnalystProvider)}
          className={`${control} px-1.5 py-0.5 text-[10px]`}
        >
          {ALL_PROVIDERS.map((p) => (
            <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
          ))}
        </select>
      </div>

      <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug">
        Turn the assessment above into a short written brief. Grounded on the same evidence; the model adds no new facts.
      </p>

      {/* Cloud provider: paste a key right here, with a one-click link to make one. */}
      {cloud && (
        <div className="space-y-1.5 rounded border border-[var(--hv-glass-border)] p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1">
              <KeyRound className="w-3 h-3" /> {PROVIDER_LABEL[cloud]} API key
            </span>
            <a href={API_KEY_URL[cloud]} target="_blank" rel="noreferrer noopener" className={`${link} text-[10px] font-mono`}>
              Get a key <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              aria-label="API key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => onKeyChange(e.target.value)}
              placeholder={`Paste your ${PROVIDER_LABEL[cloud]} key`}
              autoComplete="off"
              spellCheck={false}
              className={`${control} min-w-0 flex-1 px-2 py-1 text-[11px]`}
            />
            <button
              type="button"
              aria-label={showKey ? "Hide key" : "Show key"}
              onClick={() => setShowKey((s) => !s)}
              className="shrink-0 p-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)] transition-colors"
            >
              {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug">
            Held in this tab for the session only, never written to disk. Sent solely with this request to your own server relay, which forwards it to {PROVIDER_LABEL[cloud]} and never stores or logs it.
          </p>
        </div>
      )}

      {/* Local provider: point the way to the zero-install cloud path. */}
      {!cloud && (
        <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug">
          Prefer zero setup? Switch the provider (top right) to a cloud model and paste a key, no install needed.
        </p>
      )}

      <div className="flex items-center gap-2">
        <select
          aria-label="Analyst model"
          value={isCustom ? CUSTOM : model}
          onChange={(e) => onModelSelect(e.target.value)}
          className={`${control} min-w-0 flex-1 px-2 py-1 text-[11px]`}
        >
          {catalog.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
          <option value={CUSTOM}>Custom model…</option>
        </select>
        <button
          type="button"
          onClick={run}
          disabled={status === "loading" || model.trim() === ""}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--hv-cyan)]/40 text-[11px] font-mono text-[var(--hv-cyan)] hover:bg-[var(--hv-cyan)]/10 disabled:opacity-50 transition-colors"
        >
          {status === "loading" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
          {status === "loading" ? "Thinking…" : "Run analyst"}
        </button>
      </div>

      {isCustom && (
        <input
          aria-label="Custom model name"
          value={model}
          onChange={(e) => { setModel(e.target.value); reset(); }}
          placeholder={`e.g. ${DEFAULT_MODEL[provider]}`}
          className={`${control} w-full px-2 py-1 text-[11px]`}
        />
      )}

      <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug">{analystDisclosure(provider)}</p>

      {status === "error" && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-mono text-[#ff6b6b]">{error}</p>
          {provider === "ollama" ? (
            <div className="flex items-start gap-2 rounded border border-[var(--hv-cyan)]/30 bg-[var(--hv-cyan)]/5 p-2">
              <Terminal className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--hv-cyan)]" />
              <div className="min-w-0 text-[10px] font-mono text-[var(--hv-ink-dim)] leading-relaxed">
                <span className="block text-[var(--hv-ink)]">Start Ollama on this machine, then run again:</span>
                <code className="block">ollama serve</code>
                <code className="block">ollama pull {model.trim()}</code>
                <span className="block mt-1">Prefer no install? Switch the provider (top right) to a cloud model and paste a key.</span>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded border border-[var(--hv-cyan)]/30 bg-[var(--hv-cyan)]/5 p-2">
              <KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--hv-cyan)]" />
              <div className="min-w-0 text-[10px] font-mono text-[var(--hv-ink-dim)] leading-relaxed">
                <span className="block text-[var(--hv-ink)]">Check the {PROVIDER_LABEL[provider]} key above, then run again.</span>
                <a href={API_KEY_URL[provider]} target="_blank" rel="noreferrer noopener" className={`${link} mt-1`}>
                  Get a {PROVIDER_LABEL[provider]} key <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {status === "done" && result && (
        <div className="space-y-2">
          {result.narrative.map((line, i) => (
            <p key={i} className="text-[12px] font-mono text-[var(--hv-ink)] leading-snug">{line}</p>
          ))}
          {result.unverifiedClaims.length > 0 && (
            <div className="flex items-start gap-2 rounded border border-[#ffaa00]/40 bg-[#ffaa00]/10 p-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#ffaa00]" />
              <div className="min-w-0">
                <span className="block text-[11px] font-mono text-[#ffaa00]">
                  Unverified: not in the evidence, verify before trusting
                </span>
                <span className="block text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug break-words">
                  {result.unverifiedClaims.join(", ")}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
