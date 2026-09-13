"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, RefreshCw } from "lucide-react";
import LinkGraph, { type GraphEntity, type GraphLink } from "@/components/graph/LinkGraph";
import type { InvestigationCase } from "@/lib/types";
import { correlateCases, type CorrelatedEntity } from "@/lib/analysis/caseCorrelation";

interface Props {
  /** The browser session's own nodes, which stay editable. */
  sessionEntities: GraphEntity[];
  onChange: (next: GraphEntity[]) => void;
  /** Injectable for tests; defaults to the cases endpoint. */
  loadCases?: () => Promise<InvestigationCase[]>;
}

async function defaultLoadCases(): Promise<InvestigationCase[]> {
  const res = await fetch("/api/cases", { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { cases?: InvestigationCase[] };
  return json.cases ?? [];
}

/** Case entities and their derived edges, merged with the session's own nodes. */
export function mergeGraph(
  session: GraphEntity[],
  cases: InvestigationCase[],
): { entities: GraphEntity[]; links: GraphLink[]; shared: CorrelatedEntity[] } {
  const seen = new Set(session.map((e) => `${e.kind}:${e.value.toLowerCase()}`));
  const entities = [...session];
  const links: GraphLink[] = [];

  for (const c of cases) {
    for (const e of c.entities) {
      const key = `${e.kind}:${e.value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entities.push({ kind: e.kind, value: e.value });
    }
    for (const edge of c.edges ?? []) links.push(edge);
  }

  return { entities, links, shared: correlateCases(cases) };
}

/**
 * The link graph over everything the analyst has: this browser session AND
 * every saved case.
 *
 * It used to read from localStorage alone, so the graph forgot an investigation
 * the moment the tab was closed while the case file remembered it perfectly.
 * Cases also carry their derived EDGES, which is the difference between a star
 * of identifiers and a picture of what was inferred from what.
 *
 * Identifiers appearing in more than one case are called out separately: that
 * is the "have I seen this before" signal, and it is invisible on the canvas.
 */
export default function InvestigationGraph({ sessionEntities, onChange, loadCases = defaultLoadCases }: Props) {
  const [cases, setCases] = useState<InvestigationCase[]>([]);
  const [includeCases, setIncludeCases] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setCases(await loadCases());
    setBusy(false);
  }, [loadCases]);

  // Data-fetching on mount: there is no external store to subscribe to, and the
  // case half of the graph cannot render without it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  const merged = includeCases
    ? mergeGraph(sessionEntities, cases)
    : { entities: sessionEntities, links: [] as GraphLink[], shared: [] as CorrelatedEntity[] };

  const fromCases = merged.entities.length - sessionEntities.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="text-[11px] font-mono text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <input type="checkbox" checked={includeCases} onChange={(e) => setIncludeCases(e.target.checked)} />
          <Database className="w-3 h-3" />
          include saved cases{includeCases && fromCases > 0 ? ` (+${fromCases} identifiers)` : ""}
        </label>
        <button type="button" onClick={() => void refresh()} disabled={busy}
          className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)] disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} /> Reload cases
        </button>
      </div>

      <LinkGraph
        entities={merged.entities}
        links={merged.links}
        title="INVESTIGATION LINK GRAPH"
        onChange={onChange}
      />

      {merged.shared.length > 0 && (
        <div className="terminal-card p-4 space-y-1">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)]">
            SHARED ACROSS CASES: {merged.shared.length}
          </div>
          {merged.shared.slice(0, 12).map((s) => (
            <div key={`${s.kind}:${s.value}`} className="text-[11px] font-mono text-[var(--hv-ink)]">
              <span className="text-[var(--hv-cyan)]">{s.kind}</span> {s.value}
              <span className="text-[var(--hv-ink-dim)]"> in {s.cases.map((c) => c.name).join(", ")}</span>
            </div>
          ))}
          <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
            An identifier in two investigations is worth a second look. Editing the graph changes only this
            session&apos;s nodes; case entities are edited in the case itself.
          </p>
        </div>
      )}
    </div>
  );
}
