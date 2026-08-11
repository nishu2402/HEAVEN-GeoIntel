"use client";

import { useState } from "react";
import { FolderPlus, Check, Plus, Loader2 } from "lucide-react";
import type { InvestigationCase, EntityKind, EntityRef } from "@/lib/types";
import type { ExtractedEntity } from "@/lib/analysis/entityExtract";
import type { Facts, SnapshotDiff } from "@/lib/analysis/caseSnapshot";

// A self-contained "pin this result to a case" control for any result dashboard.
// It's decoupled from the Cases panel: the server (/api/cases) is the single
// source of truth, so this just lazily fetches the case list when opened and
// POSTs the entities. `entities[0]` is the primary identifier; the rest are the
// result's derived identifiers (resolved IPs, reverse host, confirmed profiles…)
// which the analyst can opt into pinning in the same click.

/** A derived relationship to persist with the pin. */
export interface EdgeInput {
  from: EntityRef;
  to: EntityRef;
  reason: string;
}

interface Props {
  /** Non-empty; entities[0] is the primary, the rest are "related". */
  entities: ExtractedEntity[];
  /**
   * Auto-pivot links for this result. Pinned alongside the entities so the
   * case keeps the derivation, not just the identifiers.
   */
  edges?: EdgeInput[];
  /**
   * Comparable fingerprint of this lookup. Posting it returns what moved since
   * the last time the same identifier was pinned to the same case — the
   * "re-run and show me what changed" loop.
   */
  snapshot?: { kind: EntityKind; value: string; facts: Facts; fromCache?: boolean };
}

const KIND_COLOR: Record<EntityKind, string> = {
  phone: "#00ff85", email: "#22d3ee", username: "#e879f9", ip: "#fb923c", domain: "#facc15",
};

/** "2 IP, 1 domain" style summary of the related entities, by kind. */
function summarize(entities: ExtractedEntity[]): string {
  const counts = new Map<EntityKind, number>();
  for (const e of entities) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(", ");
}

export default function AddToCase({ entities, edges, snapshot }: Props) {
  const [open, setOpen] = useState(false);
  const [cases, setCases] = useState<InvestigationCase[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [newName, setNewName] = useState("");
  const [includeRelated, setIncludeRelated] = useState(false);

  const primary = entities[0];
  const related = entities.slice(1);
  const toPin = includeRelated ? entities : [primary];

  async function ensureCases() {
    if (cases !== null) return;
    setLoading(true);
    try {
      const res = await fetch("/api/cases", { cache: "no-store" });
      const json = (await res.json()) as { cases?: InvestigationCase[] };
      setCases(json.cases ?? []);
    } catch { setCases([]); }
    finally { setLoading(false); }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void ensureCases();
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/cases", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return (await res.json()) as { case?: InvestigationCase; diff?: SnapshotDiff; error?: string };
  }

  function confirmAdded(name: string) {
    setAdded(name);
    setOpen(false);
    // The change summary is the point of snapshotting, so it lingers longer
    // than the plain "pinned" tick.
    setTimeout(() => { setAdded(null); setDiff(null); }, 6000);
  }

  // Sequential awaits — the case store is a single JSON file; parallel writes race.
  async function pinAll(id: string) {
    for (const e of toPin) await post({ action: "addEntity", id, kind: e.kind, value: e.value });

    // Only edges between identifiers we actually pinned: persisting a link to
    // an identifier the analyst chose NOT to pin would put a node in the case
    // graph that the case does not contain.
    if (edges && edges.length > 0) {
      const pinned = new Set(toPin.map((e) => `${e.kind}:${e.value.toLowerCase()}`));
      const keep = edges.filter(
        (e) => pinned.has(`${e.from.kind}:${e.from.value.toLowerCase()}`)
            && pinned.has(`${e.to.kind}:${e.to.value.toLowerCase()}`),
      );
      if (keep.length > 0) await post({ action: "addEdges", id, edges: keep });
    }

    if (snapshot) {
      const j = await post({
        action: "snapshot", id,
        kind: snapshot.kind, value: snapshot.value,
        facts: snapshot.facts, fromCache: snapshot.fromCache === true,
      });
      setDiff(j.diff ?? null);
    }
  }

  async function addTo(c: InvestigationCase) {
    setBusy(true);
    try { await pinAll(c.id); confirmAdded(c.name); }
    finally { setBusy(false); }
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const j = await post({ action: "create", name });
      if (j.case) {
        await pinAll(j.case.id);
        setCases((prev) => (prev ? [j.case!, ...prev] : [j.case!]));
        setNewName("");
        confirmAdded(j.case.name);
      }
    } finally { setBusy(false); }
  }

  const color = KIND_COLOR[primary.kind];
  const pinCount = toPin.length;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        // This button sits between result panels, on the page background — so it
        // uses the --hv-*-page tokens. With --hv-ink-dim / --hv-glass-border it
        // measured 1.9:1 text and 1.0:1 border on the light theme's paper, i.e.
        // an invisible control on a fully-rendered result.
        className={`flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-widest px-3 py-1 rounded border transition-all ${
          added
            ? "border-[var(--hv-page-green)] text-[var(--hv-page-green)] bg-[var(--hv-page-green)]/10"
            : "border-[var(--hv-border-page)] text-[var(--hv-ink-page-dim)] hover:text-[var(--hv-page-cyan)] hover:border-[var(--hv-page-cyan)]"
        }`}
      >
        {added
          ? <><Check className="w-3 h-3" /> PINNED → {added}</>
          : <><FolderPlus className="w-3 h-3" /> ADD TO CASE</>}
      </button>

      {added && diff && (
        <div
          role="status"
          className="absolute right-0 mt-1 z-50 w-72 terminal-card p-2.5 text-[11px] font-mono space-y-1 shadow-xl"
        >
          {diff.baseline ? (
            <div className="text-[var(--hv-ink-dim)]">
              Baseline recorded — pin this lookup again later to see what changed.
            </div>
          ) : diff.changes.length === 0 ? (
            <div className="text-[var(--hv-ink-dim)]">
              Nothing changed since {new Date(diff.previousAt!).toLocaleString()}.
              {diff.cacheInvolved && " (one side was served from cache)"}
            </div>
          ) : (
            <>
              <div className="text-[var(--hv-cyan)] uppercase tracking-widest">
                {diff.changes.length} change{diff.changes.length === 1 ? "" : "s"} since {new Date(diff.previousAt!).toLocaleDateString()}
              </div>
              {diff.changes.slice(0, 6).map((c) => (
                <div key={c.fact} className="flex items-baseline gap-1">
                  <span className="text-[var(--hv-ink-dim)]">{c.fact}</span>
                  <span className="text-[var(--hv-ink-dim)] opacity-60">{String(c.from ?? "—")}</span>
                  <span className="text-[var(--hv-ink-dim)]">→</span>
                  <span className="text-[var(--hv-green)]">{String(c.to ?? "—")}</span>
                </div>
              ))}
              {diff.cacheInvolved && (
                <div className="text-[var(--hv-amber)] opacity-80">
                  One side came from the result cache — re-check after the TTL expires.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {open && (
        <>
          {/* click-catcher so a click anywhere else closes the menu */}
          <button
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div role="menu" className="absolute right-0 mt-1 z-50 w-64 terminal-card p-2 space-y-1 shadow-xl">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)] px-1 pb-1 flex items-center gap-1">
              PIN
              <span className="px-1 rounded" style={{ color, border: `1px solid ${color}55` }}>{primary.kind}</span>
              <span className="text-[var(--hv-ink)] truncate">{primary.value}</span>
            </div>

            {related.length > 0 && (
              <label className="flex items-start gap-1.5 px-1 pb-1 text-[10px] font-mono text-[var(--hv-ink-dim)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeRelated}
                  onChange={(e) => setIncludeRelated(e.target.checked)}
                  className="mt-0.5 accent-[var(--hv-cyan)]"
                />
                <span>also pin <span className="text-[var(--hv-cyan)]">{related.length} related</span> ({summarize(related)})</span>
              </label>
            )}

            {loading ? (
              <div className="flex items-center gap-2 text-[var(--hv-ink-dim)] text-xs font-mono px-1 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading cases…
              </div>
            ) : cases && cases.length > 0 ? (
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {cases.map((c) => (
                  <button
                    key={c.id}
                    role="menuitem"
                    disabled={busy}
                    onClick={() => addTo(c)}
                    className="w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs font-mono text-[var(--hv-ink)] hover:bg-[var(--hv-green)]/10 hover:text-[var(--hv-green)] transition-colors disabled:opacity-50"
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="text-[10px] opacity-60 shrink-0">{c.entities.length}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[11px] font-mono text-[var(--hv-ink-dim)] px-1 py-1.5">No cases yet — create one below.</div>
            )}

            <div className="flex gap-1 pt-1 border-t border-[var(--hv-glass-border)]">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void createAndAdd(); }}
                placeholder={pinCount > 1 ? `new case (pins ${pinCount})` : "new case name"}
                aria-label="New case name"
                className="terminal-input flex-1 min-w-0 px-2 py-1 text-xs font-mono"
              />
              <button
                onClick={createAndAdd}
                disabled={busy || !newName.trim()}
                aria-label="Create case and pin"
                className="flex items-center justify-center px-2 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)] hover:border-[var(--hv-cyan)] transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
