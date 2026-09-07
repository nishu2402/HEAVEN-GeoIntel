"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, X, ArrowUpCircle, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import type { UpdateInfo } from "@/lib/update/semver";

/**
 * "New version available", the way a professional tool shows it.
 *
 * On load this asks `/api/version` — which compares the running build against
 * the latest GitHub release — and, if a newer release exists, lights an amber
 * dot on the header button. Opening the button shows the current and latest
 * versions with a link to the release, and a "Check for updates" button that
 * forces a fresh check.
 *
 * The last answer is cached in localStorage for six hours so the badge is
 * present the instant the page loads and a reload does not re-hit the endpoint;
 * the server caps it at one GitHub call an hour regardless. Every storage access
 * is wrapped: a private-mode or blocked store simply means "check again", never
 * a crash. The component only ever reflects what the endpoint returned — it
 * shows an update only when one genuinely exists.
 */

const CACHE_KEY = "hv:update:v1";
const THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h between automatic checks

interface CachedCheck {
  at: number;
  info: UpdateInfo;
}

function readCache(): CachedCheck | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCheck;
    if (parsed && typeof parsed.at === "number" && parsed.info) return parsed;
    return null;
  } catch {
    return null;
  }
}

export default function UpdateChecker() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const check = useCallback((force: boolean) => {
    setLoading(true);
    setFailed(false);
    fetch(force ? "/api/version?force=1" : "/api/version")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j: UpdateInfo) => {
        setInfo(j);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), info: j })); } catch { /* unwritable store: next load just checks again */ }
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // Hydrate from a fresh cached answer so the badge is present immediately,
  // otherwise ask the endpoint.
  const bootstrap = useCallback(() => {
    const cached = readCache();
    if (cached && Date.now() - cached.at < THROTTLE_MS) setInfo(cached.info);
    else check(false);
  }, [check]);

  // Run the check once on mount. A fetch-on-mount side effect is exactly what an
  // effect is for; the synchronous setState inside is what the rule flags.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { bootstrap(); }, [bootstrap]);

  const updateAvailable = info?.ok === true && info.updateAvailable;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={updateAvailable ? `Update available: ${info?.latest}` : "Check for updates"}
        aria-label={updateAvailable ? "Update available" : "Software updates"}
        className="relative p-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        {updateAvailable && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--hv-amber)] ring-2 ring-[var(--hv-bg)]"
          />
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[7vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />
          <div className="glass-pop relative w-full max-w-sm rounded-xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--hv-glass-border)]">
              <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-widest text-[var(--hv-cyan)]">
                <RefreshCw className="w-4 h-4" /> Software update
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between text-[12px] font-mono">
                <span className="text-[var(--hv-ink-dim)]">Installed</span>
                <span className="text-[var(--hv-ink)]">v{APP_VERSION}</span>
              </div>

              {loading && !info && (
                <div className="text-center py-3 text-[12px] font-mono text-[var(--hv-ink-dim)]">Checking for updates…</div>
              )}

              {failed && (
                <div className="flex items-start gap-2 text-[12px] font-mono text-[var(--hv-red)]">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Could not reach this instance to check for updates.</span>
                </div>
              )}

              {info && !failed && (
                <>
                  {!info.ok ? (
                    <div className="flex items-start gap-2 text-[12px] font-mono text-[var(--hv-ink-dim)]">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--hv-amber)]" />
                      <span>Could not check for updates{info.reason ? ` (${info.reason})` : ""}. The running build is unaffected.</span>
                    </div>
                  ) : updateAvailable ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[12px] font-mono">
                        <span className="text-[var(--hv-ink-dim)]">Latest</span>
                        <span className="text-[var(--hv-amber)] font-bold">{info.latest}</span>
                      </div>
                      <div className="flex items-start gap-2 text-[12px] font-mono text-[var(--hv-amber)]">
                        <ArrowUpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>A newer version is available{info.publishedAt ? `, published ${info.publishedAt.slice(0, 10)}` : ""}.</span>
                      </div>
                      <a
                        href={info.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 text-[12px] font-mono text-[var(--hv-cyan)] hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> View the release notes
                      </a>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[12px] font-mono text-[var(--hv-green)]">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>You are on the latest version.</span>
                    </div>
                  )}
                </>
              )}

              <button
                onClick={() => check(true)}
                disabled={loading}
                className="w-full mt-1 flex items-center justify-center gap-2 rounded-md border border-[var(--hv-glass-border)] px-3 py-1.5 text-[12px] font-mono text-[var(--hv-ink)] hover:border-[var(--hv-glass-hi)] hover:text-[var(--hv-cyan)] disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Checking…" : "Check for updates"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
