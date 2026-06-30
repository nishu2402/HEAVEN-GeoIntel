"use client";

import { useEffect, useState, useCallback } from "react";
import { Database, X, CheckCircle2, ExternalLink, Save, Trash2, Loader2, ShieldAlert } from "lucide-react";

interface SourceInfo {
  id: string;
  name: string;
  tier: "free" | "key";
  configured: boolean;
  via?: "ui" | "env" | null;
  keys?: string[];
  unlocks: string;
  modes: string[];
  signup?: string;
}
interface SourcesResponse { sources: SourceInfo[]; keyActive: number; keyTotal: number }

// Pretty label for an env-var name, e.g. TWILIO_ACCOUNT_SID → "Account Sid".
function keyLabel(name: string): string {
  return name
    .replace(/_API_KEY$/, "")
    .replace(/^TWILIO_/, "")
    .replace(/^RAPIDAPI$/, "RapidAPI")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function FreeRow({ s }: { s: SourceInfo }) {
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-[var(--hv-glass-border)] last:border-b-0">
      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-[var(--hv-green)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-mono font-bold text-[var(--hv-ink)]">{s.name}</span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)]">{s.modes.join(" · ")}</span>
        </div>
        <div className="text-[12px] font-mono text-[var(--hv-ink-dim)] leading-tight mt-0.5">{s.unlocks}</div>
      </div>
      <span className="text-[10px] font-mono uppercase tracking-widest shrink-0 mt-0.5 text-[var(--hv-green)]">ON</span>
    </div>
  );
}

export default function SourcesPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch("/api/sources")
      .then((r) => r.json())
      .then((j: SourcesResponse) => setData(j))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (open && !data) refresh(); }, [open, data, refresh]);

  const saveSource = useCallback(async (s: SourceInfo) => {
    if (!s.keys) return;
    setBusy(s.id);
    try {
      for (const name of s.keys) {
        const v = (inputs[name] || "").trim();
        if (v) {
          await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, value: v }) });
        }
      }
      setInputs((prev) => { const n = { ...prev }; s.keys!.forEach((k) => delete n[k]); return n; });
      refresh();
    } finally { setBusy(null); }
  }, [inputs, refresh]);

  const clearSource = useCallback(async (s: SourceInfo) => {
    if (!s.keys) return;
    setBusy(s.id);
    try {
      for (const name of s.keys) await fetch(`/api/keys?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      refresh();
    } finally { setBusy(null); }
  }, [refresh]);

  const free = data?.sources.filter((s) => s.tier === "free") ?? [];
  const keys = data?.sources.filter((s) => s.tier === "key") ?? [];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Data sources & API keys"
        aria-label="Data sources and API keys"
        className="p-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors"
      >
        <Database className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[7vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />
          <div className="glass-pop relative w-full max-w-lg rounded-xl overflow-hidden flex flex-col max-h-[84vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--hv-glass-border)]">
              <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-widest text-[var(--hv-cyan)]">
                <Database className="w-4 h-4" /> Data sources &amp; keys
                {data && <span className="text-[var(--hv-ink-dim)]">· {data.keyActive}/{data.keyTotal} keys active</span>}
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-4">
              {loading && !data && <div className="text-center py-6 text-sm font-mono text-[var(--hv-ink-dim)]">Loading…</div>}
              {data && (
                <>
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--hv-green)]/60 mb-1">Always on — no key needed</div>
                    {free.map((s) => <FreeRow key={s.id} s={s} />)}
                  </div>

                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--hv-amber)]/70 mb-2">Optional API keys — add yours below to unlock</div>
                    <div className="space-y-2.5">
                      {keys.map((s) => (
                        <div key={s.id} className="rounded-md border border-[var(--hv-glass-border)] p-2.5 space-y-2">
                          <div className="flex items-start gap-2 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[13px] font-mono font-bold text-[var(--hv-ink)]">{s.name}</span>
                                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)]">{s.modes.join(" · ")}</span>
                                {s.signup && (
                                  <a href={s.signup} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--hv-cyan)] hover:underline">
                                    <ExternalLink className="w-2.5 h-2.5" /> get a free key
                                  </a>
                                )}
                              </div>
                              <div className="text-[12px] font-mono text-[var(--hv-ink-dim)] leading-tight mt-0.5">{s.unlocks}</div>
                            </div>
                            <span className={`text-[10px] font-mono uppercase tracking-widest shrink-0 px-1.5 py-0.5 rounded border ${
                              s.configured
                                ? "text-[var(--hv-green)] border-[var(--hv-green)]/40"
                                : "text-[var(--hv-ink-dim)] border-[var(--hv-glass-border)]"
                            }`}>
                              {s.configured ? (s.via === "env" ? "via .env" : "active") : "not set"}
                            </span>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-1.5">
                            <div className="flex-1 flex flex-col gap-1.5">
                              {(s.keys ?? []).map((name) => (
                                <input
                                  key={name}
                                  type="password"
                                  autoComplete="off"
                                  spellCheck={false}
                                  value={inputs[name] ?? ""}
                                  onChange={(e) => setInputs((p) => ({ ...p, [name]: e.target.value }))}
                                  placeholder={s.keys!.length > 1 ? `${keyLabel(name)}…` : (s.configured ? "replace key…" : "paste key…")}
                                  className="terminal-input px-2.5 py-1.5 text-xs font-mono w-full"
                                  aria-label={name}
                                />
                              ))}
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              <button
                                onClick={() => saveSource(s)}
                                disabled={busy === s.id || !(s.keys ?? []).some((k) => (inputs[k] ?? "").trim())}
                                className="flex items-center gap-1 text-[11px] font-mono font-bold uppercase tracking-widest px-2.5 py-1.5 rounded border border-[var(--hv-green)]/50 text-[var(--hv-green)] hover:bg-[var(--hv-green)]/10 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                              >
                                {busy === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                              </button>
                              {s.configured && s.via === "ui" && (
                                <button
                                  onClick={() => clearSource(s)}
                                  disabled={busy === s.id}
                                  aria-label={`Clear ${s.name} key`}
                                  className="flex items-center px-2 py-1.5 rounded border border-[var(--hv-red)]/40 text-[var(--hv-red)] hover:bg-[var(--hv-red)]/10 disabled:opacity-35 transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-start gap-2 text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1 border-t border-[var(--hv-glass-border)]">
                    <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--hv-amber)]" />
                    <span>
                      Keys are stored on the server in <code>.data/keys.json</code> (owner-only, git-ignored) and never sent back to the browser. The app works fully without them. If you expose it on a network, set <code>AUTH_PASSWORD</code>.
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
