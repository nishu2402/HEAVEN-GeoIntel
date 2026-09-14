"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Settings, X, Save, Trash2, Loader2, Eye, EyeOff, ExternalLink, ShieldAlert, KeyRound,
} from "lucide-react";
import { displayKeyLabel, providerForKey, sourceForKey, sourceKeyLabel, PROVIDER_KEYS } from "@/lib/client/keyNames";

/**
 * SETTINGS — one place to put every API key the app can use.
 *
 * The keys already had two homes and neither was a settings pane: an OSINT
 * source's key was entered in the sources dialog, and an AI provider's key only
 * in the analyst panel, which is itself only reachable underneath a finished
 * lookup. So the way to give this app a Gemini key was to run a lookup first.
 *
 * This pane is driven by the server's own allow-list (GET /api/keys returns the
 * names it will accept and where each one is currently configured), so a key
 * added to the store shows up here without anyone remembering to list it. The
 * sources dialog is still the place that explains what each OSINT source
 * unlocks; this is the place that holds the keys.
 *
 * A stored value is never sent back to the browser. Each field starts empty and
 * what it shows is only ever what the operator just typed: "saved on this
 * machine" is a status, not a readback.
 */

type KeySource = "ui" | "env" | null;

interface KeysResponse {
  keys: Record<string, KeySource>;
  names: string[];
}

/** What one row needs to render, whichever half of the app the key belongs to. */
interface Row {
  name: string;
  label: string;
  /** The provider's own key console, when there is one to link to. */
  console?: string;
  free?: boolean;
}

const AI_ROWS: Row[] = PROVIDER_KEYS.map((p) => ({
  name: p.name,
  label: p.label,
  console: p.console,
  free: p.free,
}));

/**
 * Split the server's allow-list into the AI providers and everything else,
 * keeping the AI rows in the picker's order and the source rows in the order
 * the store lists them.
 */
function splitRows(names: string[]): { ai: Row[]; osint: Row[] } {
  const ai: Row[] = [];
  for (const row of AI_ROWS) if (names.includes(row.name)) ai.push(row);
  const osint = names
    .filter((n) => providerForKey(n) === null)
    .map((n) => ({ name: n, label: sourceKeyLabel(n), console: sourceForKey(n)?.signup }));
  return { ai, osint };
}

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<KeysResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/keys", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as KeysResponse);
      setLoadError(false);
    } catch {
      // Say so rather than render an empty pane, which reads as "no keys are
      // supported here" instead of "we could not ask".
      setLoadError(true);
    }
  }, []);

  // Load the key map the first time the pane opens: a fetch-on-open side effect,
  // and the only moment the answer can be known.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (open && !data) void refresh(); }, [open, data, refresh]);

  // Takes the value rather than reading it back out of `typed`: the button
  // already has the trimmed string and is disabled while it is empty, so there
  // is no empty case here to defend against.
  const save = useCallback(async (name: string, value: string) => {
    setBusy(name);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value }),
      });
      if (!res.ok) {
        setError(`The server rejected the ${displayKeyLabel(name)} key.`);
        return;
      }
      // Clear the field only once the server has taken the value: wiping it on a
      // rejected save looks exactly like success and loses the paste.
      setTyped((prev) => ({ ...prev, [name]: "" }));
      setNote(`${displayKeyLabel(name)} key saved on this machine.`);
      await refresh();
    } catch {
      setError("Could not reach the server to save the key.");
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const remove = useCallback(async (name: string) => {
    setBusy(name);
    setError("");
    setNote("");
    try {
      const res = await fetch(`/api/keys?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) {
        setError(`The server could not remove the ${displayKeyLabel(name)} key.`);
        return;
      }
      setNote(`${displayKeyLabel(name)} key removed from this machine.`);
      await refresh();
    } catch {
      setError("Could not reach the server to remove the key.");
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const rows = splitRows(data?.names ?? []);
  const sourceOf = (name: string): KeySource => data?.keys[name] ?? null;
  const savedHere = Object.values(data?.keys ?? {}).filter((v) => v === "ui").length;

  const chip = "flex items-center gap-1 text-[11px] font-mono font-bold uppercase tracking-widest px-2.5 py-1.5 rounded border transition-colors disabled:opacity-35 disabled:cursor-not-allowed";

  const section = (title: string, blurb: string, list: Row[]) => (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--hv-amber)]/70 mb-1">{title}</div>
      <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] leading-snug mb-2">{blurb}</p>
      <div className="space-y-2">
        {list.map((row) => {
          const via = sourceOf(row.name);
          const value = typed[row.name] ?? "";
          return (
            <div key={row.name} className="rounded-md border border-[var(--hv-glass-border)] p-2.5 space-y-2">
              <div className="flex items-start gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-mono font-bold text-[var(--hv-ink)]">{row.label}</span>
                    {row.free && (
                      <span className="text-[10px] font-mono text-[var(--hv-green)]">free tier</span>
                    )}
                    {row.console && (
                      <a
                        href={row.console}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--hv-cyan)] hover:underline"
                      >
                        <ExternalLink className="w-2.5 h-2.5" /> create a key
                      </a>
                    )}
                  </div>
                  <code className="block text-[10px] font-mono text-[var(--hv-ink-dim)] mt-0.5">{row.name}</code>
                </div>
                <span className={`text-[10px] font-mono uppercase tracking-widest shrink-0 px-1.5 py-0.5 rounded border ${
                  via === null
                    ? "text-[var(--hv-ink-dim)] border-[var(--hv-glass-border)]"
                    : "text-[var(--hv-green)] border-[var(--hv-green)]/40"
                }`}>
                  {via === "ui" ? "saved here" : via === "env" ? "from .env" : "not set"}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-1.5">
                <input
                  type={reveal ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  value={value}
                  onChange={(e) => setTyped((prev) => ({ ...prev, [row.name]: e.target.value }))}
                  placeholder={via === "ui" ? "replace the saved key…" : "paste a key…"}
                  aria-label={row.name}
                  className="terminal-input px-2.5 py-1.5 text-xs font-mono w-full flex-1"
                />
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => void save(row.name, value.trim())}
                    disabled={busy === row.name || value.trim() === ""}
                    className={`${chip} border-[var(--hv-green)]/50 text-[var(--hv-green)] hover:bg-[var(--hv-green)]/10`}
                  >
                    {busy === row.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                  </button>
                  {via === "ui" && (
                    <button
                      onClick={() => void remove(row.name)}
                      disabled={busy === row.name}
                      aria-label={`Remove ${row.label} key`}
                      className={`${chip} border-[var(--hv-red)]/40 text-[var(--hv-red)] hover:bg-[var(--hv-red)]/10`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Settings"
        aria-label="Settings"
        className="p-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors"
      >
        <Settings className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[7vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />
          <div className="glass-pop relative w-full max-w-lg rounded-xl overflow-hidden flex flex-col max-h-[84vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--hv-glass-border)]">
              <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-widest text-[var(--hv-cyan)]">
                <Settings className="w-4 h-4" /> Settings
                {data && <span className="text-[var(--hv-ink-dim)]">· {savedHere} saved on this machine</span>}
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close settings" className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)]">
                  <KeyRound className="w-3.5 h-3.5" /> API keys
                </div>
                <button
                  onClick={() => setReveal((r) => !r)}
                  className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]"
                >
                  {reveal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {reveal ? "hide what I type" : "show what I type"}
                </button>
              </div>

              {!data && !loadError && (
                <div className="text-center py-6 text-sm font-mono text-[var(--hv-ink-dim)]">Loading…</div>
              )}
              {loadError && (
                <div className="text-center py-6 space-y-2 text-sm font-mono text-[var(--hv-red)]">
                  <div>Could not load the key list: the server is unreachable.</div>
                  <button onClick={() => void refresh()} className="underline hover:text-[var(--hv-cyan)]">Retry</button>
                </div>
              )}
              {error !== "" && (
                <div role="alert" className="flex items-start gap-2 text-[12px] font-mono text-[var(--hv-red)]">
                  <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
                </div>
              )}
              {note !== "" && (
                <div role="status" className="text-[12px] font-mono text-[var(--hv-green)]">{note}</div>
              )}

              {data && (
                <>
                  {section(
                    "AI analyst",
                    "Optional. One of these lets the analyst write the assessment in prose; it is the only feature that sends a subject's data off this machine, and it stays off until you run it.",
                    rows.ai,
                  )}
                  {section(
                    "OSINT sources",
                    "Optional. Every mode works without them; a key only adds what that one source knows. The sources dialog lists what each one unlocks.",
                    rows.osint,
                  )}

                  <div className="flex items-start gap-2 text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1 border-t border-[var(--hv-glass-border)]">
                    <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--hv-amber)]" />
                    <span>
                      Keys are written to <code>.data/keys.json</code> on the server (owner-only, git-ignored) and never sent back to the browser, so a field here is blank even when a key is saved. A key set in <code>.env.local</code> shows as <em>from .env</em> and is changed there, not here. If you expose this app on a network, set <code>AUTH_PASSWORD</code>.
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
