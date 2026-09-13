"use client";

import { useCallback, useRef, useState } from "react";
import { Radar, Play, Square, ExternalLink, ShieldAlert } from "lucide-react";
import type { SweepHit, UsernameSweepResponse } from "@/lib/types";

interface Props {
  username: string;
  /** Injectable for tests; defaults to the paged sweep endpoint. */
  fetchPage?: (username: string, offset: number, includeUnvalidated?: boolean) => Promise<UsernameSweepResponse>;
}

async function defaultFetchPage(
  username: string,
  offset: number,
  includeUnvalidated = false,
): Promise<UsernameSweepResponse> {
  const res = await fetch("/api/username-sweep", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, offset, includeUnvalidated }),
  });
  if (!res.ok) throw new Error(`sweep failed (HTTP ${res.status})`);
  return (await res.json()) as UsernameSweepResponse;
}

/**
 * The deep sweep: the WhatsMyName catalog, auto-classified against each site's
 * own four-field detection contract.
 *
 * The catalog used to be offered as manual links only, on the reasoning that
 * community detection strings were not something to depend on. The contract is
 * in fact stricter than the tool's own fast-sweep rule (status AND body marker,
 * both directions), so these sites can be checked honestly — and a handle's
 * real footprint is hundreds of sites wide, not 23.
 *
 * Paged and interruptible, because it is a minute of real network traffic: the
 * analyst starts it, watches progress, and can stop it. `unknown` results are
 * counted and explained rather than hidden, since a bot-walled site is a gap in
 * coverage, not an absence of the account.
 */
export default function DeepSweepPanel({ username, fetchPage = defaultFetchPage }: Props) {
  const [hits, setHits] = useState<SweepHit[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unvalidated, setUnvalidated] = useState(0);
  const [deep, setDeep] = useState(false);
  const stop = useRef(false);

  const run = useCallback(async (includeUnvalidated: boolean) => {
    stop.current = false;
    setRunning(true);
    setFinished(false);
    setError(null);
    setHits([]);
    setDone(0);
    let offset: number | null = 0;
    try {
      while (offset !== null && !stop.current) {
        const page: UsernameSweepResponse = await fetchPage(username, offset, includeUnvalidated);
        setTotal(page.total);
        setUnvalidated(page.unvalidated);
        setDone(page.offset + page.limit);
        setHits((prev) => [...prev, ...page.hits.filter((h) => h.status === "found")]);
        offset = page.nextOffset;
      }
      setFinished(offset === null);
    } catch {
      setError("the sweep request failed");
    } finally {
      setRunning(false);
    }
  }, [fetchPage, username]);

  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="terminal-card p-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Radar className="w-3.5 h-3.5" /> DEEP SWEEP{total > 0 ? `: ${done}/${total} sites` : ""}
        </div>
        {running ? (
          <button type="button" onClick={() => { stop.current = true; }}
            className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[#fb923c] hover:border-[var(--hv-glass-hi)]">
            <Square className="w-3 h-3" /> Stop
          </button>
        ) : (
          <button type="button" onClick={() => { setDeep(false); void run(false); }}
            className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-green)] hover:border-[var(--hv-glass-hi)]">
            <Play className="w-3 h-3" /> {finished || hits.length > 0 ? "Run again" : "Start"}
          </button>
        )}
      </div>

      {!running && unvalidated > 0 && (
        <button type="button" onClick={() => { setDeep(true); void run(true); }}
          className="text-[11px] font-mono text-[var(--hv-cyan)] hover:underline text-left">
          {deep ? "re-run" : "also check"} the {unvalidated} sites whose detection markers failed our last validation
        </button>
      )}

      {(running || done > 0) && (
        <div className="w-full h-1.5 bg-[var(--hv-glass-border)] rounded">
          <div className="h-full rounded bg-[var(--hv-green)]" style={{ width: `${percent}%` }} />
        </div>
      )}

      {error && <p className="text-[11px] font-mono text-[#ff4d6d]">{error}</p>}

      {hits.length > 0 && (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {hits.map((h) => (
            <a key={`${h.site}-${h.url}`} href={h.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-[11px] font-mono text-[var(--hv-ink)] hover:text-[var(--hv-cyan)]">
              <ExternalLink className="w-3 h-3 shrink-0 text-[var(--hv-green)]" />
              <span className="flex-1 break-all">{h.site}</span>
              <span className="text-[var(--hv-ink-dim)]">{h.category}</span>
            </a>
          ))}
        </div>
      )}

      {done > 0 && hits.length === 0 && !running && (
        <p className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
          No confirmed account on the {done} sites checked.
        </p>
      )}

      <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug flex items-start gap-1.5">
        <ShieldAlert className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          Only accounts confirmed by the site&apos;s own presence marker are listed. Sites behind a bot wall answer
          neither marker and are counted as unchecked, never as absent. Catalog: {" "}
          <a href="https://github.com/WebBreacher/WhatsMyName" target="_blank" rel="noopener noreferrer" className="text-[var(--hv-cyan)] hover:underline">WhatsMyName</a> (CC BY-SA 4.0).
        </span>
      </p>
    </div>
  );
}
