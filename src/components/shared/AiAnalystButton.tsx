"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot, AlertTriangle, Loader2, Terminal, KeyRound, Eye, EyeOff, ExternalLink,
  CheckCircle2, RefreshCw, Save, Trash2,
} from "lucide-react";
import { postLookup } from "@/lib/client/postLookup";
import type { AiAnalysis } from "@/lib/ai";
import {
  buildAnalystPrompt, parseAnalystResponse, analystDisclosure,
  DEFAULT_MODEL, MODEL_CATALOG, ALL_PROVIDERS, PROVIDER_LABEL, API_KEY_URL,
  PROVIDER_KEY_NAME, FREE_TIER, SETUP_DEFAULT, OLLAMA_INSTALL_URL,
  type AnalystProvider, type CloudProvider, type AnalystResult,
} from "@/lib/ai/analyst";

/**
 * AI ANALYST — the optional, opt-in language-model narration (Phase 3).
 *
 * Everything it needs is done in this panel. On open it asks the server what can
 * actually run here (/api/ai-analyst): whether a local Ollama server is up and
 * which models it holds, and which cloud providers already have a key. It then
 * selects a provider that works, preferring the local one because it is keyless
 * and leaks nothing.
 *
 * That ordering is the point. The panel used to open on Ollama whether or not
 * Ollama existed, so the first thing most operators saw was a red error and two
 * terminal commands: a dead end inside a tool meant to be used from one window.
 * Now a provider is only offered as runnable when it is, and a provider that is
 * not shows what is missing with the link that fixes it.
 *
 * A cloud key is entered here: "Create a key" opens the provider's own console
 * and the field takes the paste. Run it once as typed, or press Save to keep it
 * in the server's key store (.data/keys.json, mode 0600, the same place the
 * OSINT provider keys live) so it never has to be pasted again. The key is never
 * written to browser storage, and the relay neither logs nor echoes it.
 *
 * The reply is re-validated either way: any identifier the model wrote that was
 * not in the evidence is shown as UNVERIFIED, never as fact.
 */

type RunStatus = "idle" | "loading" | "done" | "error";

// Sentinel value for the model dropdown's "type my own" row.
const CUSTOM = "__custom__";

/** One provider's readiness, as /api/ai-analyst reports it. */
interface ProviderStatus {
  id: AnalystProvider;
  label: string;
  ready: boolean;
  keySource: "ui" | "env" | null;
  models: string[];
  hint: string;
}

/**
 * The report's shape as this panel reads it. The endpoint also returns
 * `ollamaRunning` for API consumers; the panel does not need it, because each
 * provider already carries the sentence describing what it is missing.
 */
interface AnalystStatus {
  providers: ProviderStatus[];
  recommended: AnalystProvider | null;
}

export default function AiAnalystButton({ analysis }: { analysis: AiAnalysis }) {
  const [probe, setProbe] = useState<AnalystStatus | null>(null);
  const [probing, setProbing] = useState(true);
  const [provider, setProvider] = useState<AnalystProvider>(SETUP_DEFAULT);
  // Null means "whatever this provider offers first", so the selection follows a
  // provider that becomes ready mid-session instead of holding a suggestion the
  // machine turns out not to have. It is set only when the operator picks one.
  const [chosen, setChosen] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [result, setResult] = useState<AnalystResult | null>(null);
  const [error, setError] = useState("");

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setError("");
  };

  // Ask the server what is runnable, and adopt its recommendation. Called on
  // open, on "Check again", and after a key is saved, so the panel reflects the
  // machine rather than a guess made at build time.
  const refresh = useCallback(async (adopt: boolean) => {
    let next: AnalystStatus | null = null;
    try {
      const res = await fetch("/api/ai-analyst", { headers: { accept: "application/json" } });
      if (res.ok) next = (await res.json()) as AnalystStatus;
    } catch {
      // Leave `next` null: the panel then shows every provider as unconfigured
      // with its setup block, which is the safe reading of "we could not ask".
    }
    setProbe(next);
    setProbing(false);
    if (adopt && next?.recommended) setProvider(next.recommended);
  }, []);

  // Probe once when the panel mounts. refresh() sets state after its await (what
  // the rule flags), but asking an external system what it can do on open is
  // precisely what an effect is for, and the answer cannot be known any earlier.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(true); }, [refresh]);

  const recheck = () => {
    setProbing(true);
    setKeyError("");
    // Drop the failed run with it. Check again is only reachable from a provider
    // that could not run, so the error it clears is always the stale one, and
    // leaving it on screen under a provider that is now ready reads as a fresh
    // failure.
    reset();
    void refresh(false);
  };

  // Null for the local, keyless Ollama; the narrowed provider otherwise, so the
  // key-only maps (API_KEY_URL, PROVIDER_KEY_NAME) can be indexed safely.
  const cloud: CloudProvider | null = provider === "ollama" ? null : provider;
  const info = probe?.providers.find((p) => p.id === provider);
  const ready = info?.ready ?? false;
  // A probe that never answered is reported as such rather than as a provider
  // problem, so the operator is not sent to fix the wrong thing.
  const hint = info?.hint ?? "Could not ask the server which providers are available.";
  const typedKey = apiKey.trim();

  // A provider's own block appears while it cannot run, and again after a failed
  // run: a saved key that the provider rejects has to be replaceable right here,
  // or the error is another dead end. The two states are complements, so a run
  // that just failed never sits under a line still calling the provider ready.
  const showSetup = !probing && (!ready || status === "error");
  const showReady = !probing && !showSetup;

  // Installed models when the local server named them; the suggestion catalog
  // otherwise. The catalog stays available for cloud providers, where there is
  // nothing to enumerate.
  const catalog = info && info.models.length > 0 ? info.models : MODEL_CATALOG[provider];
  /* v8 ignore next 3 -- the last arm is unreachable: MODEL_CATALOG names models
     for every provider, and the installed list only replaces it when it has
     entries, so catalog[0] always exists. Kept so the type is a plain string. */
  const model = chosen ?? catalog[0] ?? DEFAULT_MODEL[provider];
  // Whether the operator picked something outside what is offered (drives the
  // dropdown vs. the free-text "Custom" box). An empty pick is custom-in-progress.
  const isCustom = chosen !== null && !catalog.includes(chosen);

  // Runnable when the provider is configured, or when a key has just been typed
  // and can be used for this one request without saving.
  const canRun = ready || (cloud !== null && typedKey !== "");

  const onProvider = (p: AnalystProvider) => {
    setProvider(p);
    setChosen(null);
    setShowKey(false);
    // The typed key lives only in state; switching providers clears it so one
    // provider's key is never carried to another.
    setApiKey("");
    setKeyError("");
    reset();
  };

  const onModelSelect = (v: string) => {
    // Picking "Custom" while already on a suggestion blanks the box so the
    // operator can type; picking it again while custom keeps what they have.
    setChosen(v === CUSTOM ? (isCustom ? model : "") : v);
    reset();
  };

  const saveKey = async () => {
    /* v8 ignore next -- unreachable: Save renders only for a cloud provider and
       is disabled until the field has content. */
    if (!cloud || !typedKey) return;
    setSaving(true);
    setKeyError("");
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: PROVIDER_KEY_NAME[cloud], value: typedKey }),
      });
      if (!res.ok) {
        setKeyError("The server rejected that key. Check it and try again.");
        return;
      }
      // Only clear the field once the server has taken it: wiping it on a
      // rejected save looks exactly like success and loses what was pasted.
      setApiKey("");
      reset();
      await refresh(false);
    } catch {
      setKeyError("Could not reach the server to save the key.");
    } finally {
      setSaving(false);
    }
  };

  const forgetKey = async () => {
    /* v8 ignore next -- unreachable: Remove renders only for a saved cloud key. */
    if (!cloud) return;
    setSaving(true);
    setKeyError("");
    try {
      const res = await fetch(`/api/keys?name=${encodeURIComponent(PROVIDER_KEY_NAME[cloud])}`, { method: "DELETE" });
      if (!res.ok) {
        setKeyError("The server could not remove that key.");
        return;
      }
      reset();
      await refresh(false);
    } catch {
      setKeyError("Could not reach the server to remove the key.");
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    setStatus("loading");
    setResult(null);
    setError("");
    const { system, user } = buildAnalystPrompt(analysis);
    const body: Record<string, unknown> = { provider, model, system, user };
    // Send the typed key only for a cloud provider that has one; Ollama needs
    // none, and an empty field falls back to the saved or environment key.
    if (cloud && typedKey) body.apiKey = typedKey;
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
  const chip = "shrink-0 flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-mono transition-colors disabled:opacity-50";

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

      {probing && (
        <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Checking what this machine can run…
        </p>
      )}

      {showReady && (
        <p className="text-[10px] font-mono text-[var(--hv-green)] flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          {PROVIDER_LABEL[provider]} is ready
          {info?.keySource === "env" && " (key from the server environment)"}
          {info?.keySource === "ui" && " (key saved on this machine)"}
          .
        </p>
      )}

      {showSetup && (
        <div className="space-y-2 rounded border border-[var(--hv-glass-border)] p-2">
          {hint !== "" && (
            <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug">{hint}</p>
          )}

          {/* Cloud provider: create a key, paste it, and optionally keep it. */}
          {cloud !== null && (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1">
                  <KeyRound className="w-3 h-3" /> {PROVIDER_LABEL[cloud]} API key
                  {FREE_TIER.includes(cloud) && (
                    <span className="ml-1 normal-case tracking-normal text-[var(--hv-green)]">free tier</span>
                  )}
                </span>
                <a href={API_KEY_URL[cloud]} target="_blank" rel="noreferrer noopener" className={`${link} text-[10px] font-mono`}>
                  Create a key <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  aria-label="API key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setKeyError(""); reset(); }}
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
                <button
                  type="button"
                  onClick={saveKey}
                  disabled={saving || typedKey === ""}
                  className={`${chip} border-[var(--hv-cyan)]/40 text-[var(--hv-cyan)] hover:bg-[var(--hv-cyan)]/10`}
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                </button>
              </div>
              <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug">
                Run it as typed to use it once and forget it, or press Save to keep it on this machine so you never paste it again. It is never written to browser storage, and the relay never logs or returns it.
              </p>
              {info?.keySource === "ui" && (
                <button
                  type="button"
                  onClick={forgetKey}
                  disabled={saving}
                  className={`${chip} border-[#ff6b6b]/40 text-[#ff6b6b] hover:bg-[#ff6b6b]/10`}
                >
                  <Trash2 className="w-3 h-3" /> Remove the saved key
                </button>
              )}
            </>
          )}

          {/* Local provider: what to install, and the two commands to start it. */}
          {cloud === null && (
            <div className="flex items-start gap-2">
              <Terminal className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--hv-cyan)]" />
              <div className="min-w-0 text-[10px] font-mono text-[var(--hv-ink-dim)] leading-relaxed">
                <span className="block text-[var(--hv-ink)]">Run these in a terminal, then press Check again:</span>
                <code className="block">ollama serve</code>
                <code className="block">ollama pull {model.trim() || DEFAULT_MODEL.ollama}</code>
                <a href={OLLAMA_INSTALL_URL} target="_blank" rel="noreferrer noopener" className={`${link} mt-1`}>
                  Download Ollama <ExternalLink className="w-3 h-3" />
                </a>
                <span className="block mt-1">
                  Prefer no install? Pick a cloud provider above; {PROVIDER_LABEL[SETUP_DEFAULT]} issues a key on a free tier.
                </span>
              </div>
            </div>
          )}

          {keyError !== "" && <p className="text-[10px] font-mono text-[#ff6b6b]">{keyError}</p>}

          <button
            type="button"
            onClick={recheck}
            disabled={saving}
            className={`${chip} border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]`}
          >
            <RefreshCw className="w-3 h-3" /> Check again
          </button>
        </div>
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
          disabled={status === "loading" || probing || !canRun || model.trim() === ""}
          title={canRun ? undefined : "Set up a provider first"}
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
          onChange={(e) => { setChosen(e.target.value); reset(); }}
          placeholder={`e.g. ${DEFAULT_MODEL[provider]}`}
          className={`${control} w-full px-2 py-1 text-[11px]`}
        />
      )}

      <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug">{analystDisclosure(provider)}</p>

      {status === "error" && <p className="text-[11px] font-mono text-[#ff6b6b]">{error}</p>}

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
