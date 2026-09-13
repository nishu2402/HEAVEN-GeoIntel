"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ListChecks, AlertTriangle, Loader2, Play, Square } from "lucide-react";
import type { BulkRow, BulkJob } from "@/lib/server/bulkJobs";

/** What the POST returns when a job is queued. */
interface StartResponse {
  id: string;
  total: number;
  state: string;
  skipped: { input: string; reason: string }[];
  truncated?: number;
  error?: string;
}

const MODES = ["auto", "phone", "email", "username", "ip", "domain", "wallet", "hash"] as const;
type ModeChoice = (typeof MODES)[number];

/**
 * CSV of whatever the job produced.
 *
 * Built client-side from the rows already on screen so the download matches
 * exactly what the analyst is looking at. Cells that begin with a formula
 * character are prefixed with a quote: a phone number starts with "+", and
 * Excel would otherwise evaluate it.
 */
export function toCsv(rows: BulkRow[]): string {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.summary)))];
  const headers = ["mode", "input", "ok", "status", "error", ...keys];
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [r.mode, r.input, r.ok, r.status, r.error ?? "", ...keys.map((k) => r.summary[k])].map(esc).join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

/**
 * Bulk triage across every mode.
 *
 * The old panel ran offline phone analysis over at most 25 numbers. This queues
 * a real job — the same lookups, the same sources, the same provenance as a
 * single-target run — and streams rows in as they land, because 200 domains is
 * minutes of work and a request that long would simply time out.
 */
export default function BulkLookup() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ModeChoice>("auto");
  const [job, setJob] = useState<BulkJob | null>(null);
  const [skipped, setSkipped] = useState<StartResponse["skipped"]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stop polling when the panel goes away, so a backgrounded tab does not keep
  // a timer alive against a job nobody is watching.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Polling is a loop rather than a self-referencing callback: a job runs for
  // minutes, and the client only needs to keep asking until it stops running.
  const poll = useCallback(async (id: string) => {
    for (;;) {
      const res = await fetch(`/api/bulk-lookup?id=${encodeURIComponent(id)}`);
      if (!res.ok) { setError("the job could not be read"); setBusy(false); return; }
      const next = (await res.json()) as BulkJob;
      setJob(next);
      if (next.state !== "running") { setBusy(false); return; }
      await new Promise<void>((resolve) => { timer.current = setTimeout(resolve, 1200); });
    }
  }, []);

  const start = useCallback(async () => {
    const items = input.split(/[\n,;]+/).map((line) => line.trim()).filter(Boolean);
    if (items.length === 0) { setError("Paste some identifiers first."); return; }
    setError("");
    setJob(null);
    setSkipped([]);
    setBusy(true);
    try {
      const res = await fetch("/api/bulk-lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, mode }),
      });
      const started = (await res.json()) as StartResponse;
      if (!res.ok) { setError(started.error ?? "the job could not be started"); setBusy(false); return; }
      setSkipped(started.skipped ?? []);
      await poll(started.id);
    } catch {
      setError("the job could not be started");
      setBusy(false);
    }
  }, [input, mode, poll]);

  const cancel = useCallback(async () => {
    if (!job) return;
    await fetch(`/api/bulk-lookup?id=${encodeURIComponent(job.id)}`, { method: "DELETE" });
  }, [job]);

  const download = (done: BulkJob) => {
    const blob = new Blob([toCsv(done.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-${done.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const percent = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className="space-y-4 mt-6">
      <div className="terminal-card p-4 space-y-3">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5" /> BULK TRIAGE: any identifier, up to 500 rows
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Bulk identifier input"
          rows={6}
          placeholder={"One per line, or comma-separated.\nwordpress.org\nsecurity@example.com\n+14155552671\n8.8.8.8"}
          className="w-full bg-transparent border border-[var(--hv-glass-border)] rounded-md p-2.5 text-xs font-mono text-[var(--hv-ink)] focus:outline-none focus:border-[var(--hv-glass-hi)]"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] font-mono text-[var(--hv-ink-dim)]" htmlFor="bulk-mode">mode</label>
          <select id="bulk-mode" value={mode} onChange={(e) => setMode(e.target.value as ModeChoice)}
            className="bg-transparent border border-[var(--hv-glass-border)] rounded px-2 py-1 text-[11px] font-mono text-[var(--hv-ink)]">
            {MODES.map((m) => <option key={m} value={m} className="bg-black">{m}</option>)}
          </select>
          {busy ? (
            <button type="button" onClick={() => void cancel()} aria-label="Stop bulk lookup"
              className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[#fb923c]">
              <Square className="w-3 h-3" /> Stop
            </button>
          ) : (
            <button type="button" onClick={() => void start()} disabled={input.trim() === ""}
              aria-label="Run bulk lookup"
              className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-green)] disabled:opacity-40">
              <Play className="w-3 h-3" /> Run
            </button>
          )}
          {job && job.rows.length > 0 && (
            <button type="button" onClick={() => download(job)} aria-label="Download bulk results as CSV"
              className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)]">
              <Download className="w-3 h-3" /> CSV
            </button>
          )}
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--hv-ink-dim)]" />}
        </div>
        <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
          Each row runs the real lookup for its mode, so a bulk run costs the same upstream calls as running the rows
          by hand. In `auto` every row is classified on its own, which is what a mixed spreadsheet column needs.
        </p>
        {error && <p className="text-[11px] font-mono text-[#ff4d6d] flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" /> {error}</p>}
      </div>

      {skipped.length > 0 && (
        <div className="terminal-card p-4 space-y-1">
          <div className="text-[11px] uppercase tracking-widest text-[#fb923c]">SKIPPED: {skipped.length}</div>
          {skipped.map((s) => (
            <div key={s.input} className="text-[11px] font-mono text-[var(--hv-ink-dim)]">{s.input}: {s.reason}</div>
          ))}
        </div>
      )}

      {job && (
        <div className="terminal-card p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)]">
              {job.state.toUpperCase()}: {job.done}/{job.total}
            </div>
            <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
              {job.rows.filter((r) => r.ok).length} answered · {job.rows.filter((r) => !r.ok).length} failed
            </div>
          </div>
          <div className="w-full h-1.5 bg-[var(--hv-glass-border)] rounded">
            <div className="h-full rounded bg-[var(--hv-green)]" style={{ width: `${percent}%` }} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-[var(--hv-ink-dim)] text-left">
                  <th className="py-1 pr-3">mode</th>
                  <th className="py-1 pr-3">input</th>
                  <th className="py-1 pr-3">result</th>
                </tr>
              </thead>
              <tbody>
                {job.rows.map((r) => (
                  <tr key={`${r.mode}-${r.input}`} className="border-t border-[var(--hv-glass-border)] align-top">
                    <td className="py-1 pr-3 text-[var(--hv-ink-dim)]">{r.mode}</td>
                    <td className="py-1 pr-3 text-[var(--hv-cyan)] break-all">{r.input}</td>
                    <td className="py-1 pr-3 break-all" style={{ color: r.ok ? "var(--hv-ink)" : "#ff4d6d" }}>
                      {r.ok
                        ? Object.entries(r.summary)
                            .filter(([, v]) => v !== null && v !== "")
                            .map(([k, v]) => `${k}=${v}`)
                            .join(" · ")
                        : (r.error ?? `HTTP ${r.status}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
