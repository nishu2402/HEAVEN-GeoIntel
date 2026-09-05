"use client";

import { useEffect, useState, useCallback } from "react";
import { Landmark, X, Search, ShieldAlert } from "lucide-react";

interface NotableBreach { name: string; records: number | null; date: string | null }
interface NotableResponse { source: string; version: string | null; count: number; breaches: NotableBreach[] }

/**
 * A browsable reference of the largest documented government and institutional
 * data breaches, read from the vendored Wikipedia notable-breaches tier. These
 * incidents (national population registries, tax authorities, health ministries)
 * never entered a credential corpus, so a per-account or domain lookup never
 * returns them, and the tier used to sit inert in the bundle. This panel gives it
 * a home: a keyless, offline reference of known breaches by size.
 *
 * It is explicitly NOT a presence check. It never claims any identifier appears
 * in these breaches; the note in the panel says so plainly, which is the whole
 * reason this is a reference directory rather than a lookup result.
 */
export default function NotableBreachesPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotableResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");

  // A failed load must say so: the modal body is otherwise blank, with no hint
  // that the reference simply never arrived.
  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    fetch("/api/notable-breaches")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j: NotableResponse) => setData(j))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  // Lazy-load the reference the first time the panel opens — a data-fetching side
  // effect. refresh() sets loading synchronously (what the rule flags), but
  // fetch-on-open is exactly what an effect is for.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (open && !data) refresh(); }, [open, data, refresh]);

  const q = query.trim().toLowerCase();
  const rows = (data?.breaches ?? []).filter((b) => !q || b.name.toLowerCase().includes(q));

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Notable breaches reference"
        aria-label="Notable breaches reference"
        className="p-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors"
      >
        <Landmark className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[7vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />
          <div className="glass-pop relative w-full max-w-lg rounded-xl overflow-hidden flex flex-col max-h-[84vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--hv-glass-border)]">
              <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-widest text-[var(--hv-cyan)]">
                <Landmark className="w-4 h-4" /> Notable breaches
                {data && <span className="text-[var(--hv-ink-dim)]">· {data.count.toLocaleString()} institutional</span>}
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-2.5 border-b border-[var(--hv-glass-border)]">
              <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] leading-snug">
                The largest documented government and institutional breaches, from Wikipedia&rsquo;s public
                list. These never entered a credential corpus, so a per-account or domain lookup never returns
                them. This is a reference of known breaches by size, not a check that any identifier appears in
                one.
              </p>
            </div>

            <div className="overflow-y-auto p-4 space-y-3">
              {loading && !data && <div className="text-center py-6 text-sm font-mono text-[var(--hv-ink-dim)]">Loading…</div>}
              {loadError && !data && (
                <div className="text-center py-6 space-y-2 text-sm font-mono text-[var(--hv-red)]">
                  <div>Could not load the notable-breaches reference: the server is unreachable.</div>
                  <button onClick={refresh} className="underline hover:text-[var(--hv-cyan)]">Retry</button>
                </div>
              )}
              {data && (
                <>
                  <label className="flex items-center gap-2 rounded border border-[var(--hv-glass-border)] bg-[var(--hv-glass)] px-2">
                    <Search className="w-3.5 h-3.5 text-[var(--hv-ink-dim)] shrink-0" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by name (e.g. Ticketmaster, Capital One)…"
                      aria-label="Search notable breaches"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full text-[12px] font-mono bg-transparent py-1.5 text-[var(--hv-ink)] focus:outline-none"
                    />
                  </label>

                  {rows.length === 0 ? (
                    <div className="text-center py-6 text-[12px] font-mono text-[var(--hv-ink-dim)]">
                      No notable breach matches &ldquo;{query.trim()}&rdquo;.
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--hv-glass-border)]">
                      {rows.map((b) => (
                        <div key={b.name} className="flex items-baseline justify-between gap-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-mono font-bold text-[var(--hv-ink)] truncate">{b.name}</div>
                            {b.date && <div className="text-[10px] font-mono text-[var(--hv-ink-dim)] mt-0.5">{b.date}</div>}
                          </div>
                          {b.records !== null && (
                            <div className="text-[12px] font-mono text-[var(--hv-amber)] shrink-0">
                              {b.records.toLocaleString()} <span className="text-[var(--hv-ink-dim)]">records</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-start gap-2 text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1 border-t border-[var(--hv-glass-border)]">
                    <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--hv-amber)]" />
                    <span>
                      Source: {data.source}{data.version ? ` (revision ${data.version})` : ""}. Only rows with a
                      clean numeric record count are vendored, so a prose or ranged figure is skipped rather than
                      guessed. Refreshed offline with <code>npm run breaches:refresh</code>.
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
