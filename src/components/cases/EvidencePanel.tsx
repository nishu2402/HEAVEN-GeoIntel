"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ShieldCheck, AlertTriangle, RefreshCw, Download } from "lucide-react";
import type { EvidenceCheck, EvidenceEntry } from "@/lib/server/evidenceStore";

interface Props {
  caseId: string;
  /** Injectable for tests; defaults to the evidence endpoint. */
  load?: (caseId: string) => Promise<EvidenceEntry[]>;
  check?: (caseId: string) => Promise<EvidenceCheck[]>;
}

async function defaultLoad(caseId: string): Promise<EvidenceEntry[]> {
  const res = await fetch(`/api/evidence?caseId=${encodeURIComponent(caseId)}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { entries?: EvidenceEntry[] };
  return json.entries ?? [];
}

async function defaultCheck(caseId: string): Promise<EvidenceCheck[]> {
  const res = await fetch("/api/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "verify", caseId }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { checks?: EvidenceCheck[] };
  return json.checks ?? [];
}

const fmt = (ms: number) => new Date(ms).toLocaleString();

/**
 * The case's preserved lookup responses, each with the SHA-256 that was
 * recorded when it was captured.
 *
 * A finding nobody can re-check is a finding that does not survive being
 * challenged: upstreams change, and a re-run six months later answers a
 * different question. Verify recomputes every hash, so "this is the response
 * the report was written from" is something the analyst can demonstrate rather
 * than assert.
 */
export default function EvidencePanel({ caseId, load = defaultLoad, check = defaultCheck }: Props) {
  const [entries, setEntries] = useState<EvidenceEntry[]>([]);
  const [checks, setChecks] = useState<EvidenceCheck[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setEntries(await load(caseId));
  }, [caseId, load]);

  // Fetching the manifest on mount is a genuine data-fetching effect: there is
  // no external store to subscribe to, and the panel cannot render without it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  const verify = async () => {
    setBusy(true);
    setChecks(await check(caseId));
    setBusy(false);
  };

  if (entries.length === 0) {
    return (
      <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
        No preserved responses yet. Use PRESERVE on a result to write it here with its hash.
      </div>
    );
  }

  const byId = new Map((checks ?? []).map((c) => [c.id, c]));
  const bad = (checks ?? []).filter((c) => c.state !== "ok").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Archive className="w-3.5 h-3.5" /> EVIDENCE: {entries.length} preserved
        </div>
        <button type="button" onClick={() => void verify()} disabled={busy}
          className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)] disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} /> Verify hashes
        </button>
      </div>

      {checks && (
        <div className="text-[11px] font-mono flex items-center gap-1.5" style={{ color: bad === 0 ? "var(--hv-green)" : "#ff4d6d" }}>
          {bad === 0 ? <ShieldCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          {bad === 0
            ? `all ${checks.length} artifacts hash to their recorded value`
            : `${bad} of ${checks.length} artifacts no longer match their recorded hash`}
        </div>
      )}

      <div className="space-y-1 max-h-72 overflow-y-auto">
        {entries.map((e) => {
          const state = byId.get(e.id)?.state;
          return (
            <div key={e.id} className="rounded-md border border-[var(--hv-glass-border)] p-2 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
                <span className="text-[var(--hv-cyan)]">{e.mode}</span>
                <span className="text-[var(--hv-ink)] break-all">{e.identifier}</span>
                <span className="text-[var(--hv-ink-dim)]">{fmt(e.capturedAt)}</span>
                <span className="text-[var(--hv-ink-dim)]">{(e.bytes / 1024).toFixed(1)} KB</span>
                {state && (
                  <span style={{ color: state === "ok" ? "var(--hv-green)" : "#ff4d6d" }}>{state}</span>
                )}
                <a href={`/api/evidence?caseId=${encodeURIComponent(caseId)}&id=${encodeURIComponent(e.id)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--hv-cyan)] hover:underline">
                  <Download className="w-3 h-3" /> open
                </a>
              </div>
              <div className="text-[10px] font-mono text-[var(--hv-ink-dim)] break-all">sha256 {e.sha256}</div>
              {e.sources.length > 0 && (
                <div className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
                  sources: {e.sources.map((s) => `${s.source}${s.ok ? "" : " (no answer)"}`).join(", ")}
                </div>
              )}
              {e.note && <div className="text-[10px] font-mono text-[var(--hv-ink)]">note: {e.note}</div>}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
        Each artifact is the API response exactly as it was returned, stored under the hash of its own bytes. That
        covers each source&apos;s payload where the response carries it, and every source&apos;s provenance row. It is
        not a packet capture.
      </p>
    </div>
  );
}
