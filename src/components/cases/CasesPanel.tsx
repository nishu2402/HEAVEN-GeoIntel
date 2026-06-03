"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FolderPlus, Trash2, Plus, X, Save, FolderOpen, Loader2, RefreshCw,
} from "lucide-react";
import type { InvestigationCase, EntityKind } from "@/lib/types";
import { LOOKUP_MODES } from "@/lib/modes";
import LinkGraph, { type GraphEntity } from "@/components/graph/LinkGraph";

const KIND_COLOR: Record<EntityKind, string> = {
  phone: "#00ff85", email: "#22d3ee", username: "#e879f9", ip: "#fb923c", domain: "#facc15",
};

export default function CasesPanel() {
  const [cases, setCases] = useState<InvestigationCase[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [entKind, setEntKind] = useState<EntityKind>("phone");
  const [entVal, setEntVal] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);

  const active = cases.find((c) => c.id === activeId) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cases", { cache: "no-store" });
      const json = (await res.json()) as { cases: InvestigationCase[] };
      setCases(json.cases ?? []);
      setActiveId((prev) => prev ?? json.cases?.[0]?.id ?? null);
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setNotesDraft(active?.notes ?? ""); }, [active?.id, active?.notes]);

  async function api(body: Record<string, unknown>) {
    const res = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as { case?: InvestigationCase; error?: string };
    if (json.case) {
      setCases((prev) => {
        const exists = prev.some((c) => c.id === json.case!.id);
        return exists ? prev.map((c) => (c.id === json.case!.id ? json.case! : c)) : [json.case!, ...prev];
      });
    }
    return json;
  }

  async function createCase() {
    const j = await api({ action: "create", name: newName });
    if (j.case) { setActiveId(j.case.id); setNewName(""); }
  }
  async function removeCase(id: string) {
    await fetch(`/api/cases?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setCases((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }
  async function addEntity() {
    if (!active || !entVal.trim()) return;
    await api({ action: "addEntity", id: active.id, kind: entKind, value: entVal.trim() });
    setEntVal("");
  }
  async function removeEntity(kind: EntityKind, value: string) {
    if (!active) return;
    await api({ action: "removeEntity", id: active.id, kind, value });
  }
  async function saveNotes() {
    if (!active) return;
    await api({ action: "notes", id: active.id, notes: notesDraft });
    setNotesSaved(true); setTimeout(() => setNotesSaved(false), 1500);
  }
  // Editing the graph persists straight into the case: diff the next node set
  // against the current one and fire add/remove (a relabel = remove old + add
  // new). Sequential awaits avoid racing the file-backed store.
  async function syncGraph(next: GraphEntity[]) {
    if (!active) return;
    const keyOf = (e: GraphEntity) => `${e.kind}::${e.value.toLowerCase()}`;
    const cur: GraphEntity[] = active.entities.map((e) => ({ kind: e.kind, value: e.value }));
    const nextKeys = new Set(next.map(keyOf));
    const curKeys = new Set(cur.map(keyOf));
    for (const e of cur) if (!nextKeys.has(keyOf(e))) await api({ action: "removeEntity", id: active.id, kind: e.kind, value: e.value });
    for (const e of next) if (!curKeys.has(keyOf(e))) await api({ action: "addEntity", id: active.id, kind: e.kind, value: e.value });
  }

  return (
    <div className="space-y-4 mt-6">
      {/* Create + list */}
      <div className="terminal-card p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5" /> INVESTIGATION CASES — persistent across sessions
          </div>
          <button onClick={load} className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)]" aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
        <div className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createCase()}
            placeholder="New case name (e.g. Acme phishing 2026)"
            className="terminal-input flex-1 px-3 py-2 text-sm font-mono" />
          <button onClick={createCase} className="btn-neon flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest">
            <FolderPlus className="w-3.5 h-3.5" /> CREATE
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[var(--hv-ink-dim)] text-sm font-mono py-3"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : cases.length === 0 ? (
          <div className="text-sm font-mono text-[var(--hv-ink-dim)] py-3">No cases yet. Create one to start grouping identifiers.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {cases.map((c) => (
              <button key={c.id} onClick={() => setActiveId(c.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-mono transition-all ${
                  activeId === c.id ? "border-[var(--hv-green)] text-[var(--hv-green)] bg-[var(--hv-green)]/10" : "border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:border-[var(--hv-glass-hi)]"
                }`}>
                {c.name}
                <span className="text-[10px] opacity-60">{c.entities.length}</span>
                <span role="button" tabIndex={0} aria-label={`Delete ${c.name}`}
                  onClick={(e) => { e.stopPropagation(); void removeCase(c.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void removeCase(c.id); } }}
                  className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-red)]"><Trash2 className="w-3 h-3" /></span>
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <>
          {/* Entities + add */}
          <div className="terminal-card p-4 space-y-3">
            <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)]">
              {active.name} — {active.entities.length} identifier{active.entities.length === 1 ? "" : "s"}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={entKind} onChange={(e) => setEntKind(e.target.value as EntityKind)}
                className="terminal-input px-3 py-2 text-sm font-mono">
                {LOOKUP_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <input value={entVal} onChange={(e) => setEntVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addEntity()}
                placeholder="value to add (e.g. +14155552671)" className="terminal-input flex-1 px-3 py-2 text-sm font-mono" />
              <button onClick={addEntity} className="btn-neon flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest">
                <Plus className="w-3.5 h-3.5" /> ADD
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {active.entities.map((e) => (
                <span key={`${e.kind}-${e.value}`} className="flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-mono"
                  style={{ borderColor: KIND_COLOR[e.kind] + "55", color: KIND_COLOR[e.kind], background: KIND_COLOR[e.kind] + "12" }}>
                  <span className="opacity-60">{e.kind}</span> {e.value}
                  <button onClick={() => removeEntity(e.kind, e.value)} aria-label="Remove" className="hover:opacity-100 opacity-60"><X className="w-3 h-3" /></button>
                </span>
              ))}
              {active.entities.length === 0 && <span className="text-[12px] font-mono text-[var(--hv-ink-dim)]">No identifiers yet — add the phone/email/username/IP/domain you&apos;re investigating.</span>}
            </div>
          </div>

          {/* Graph */}
          <LinkGraph entities={active.entities.map((e) => ({ kind: e.kind, value: e.value }))} title={`${active.name.toUpperCase()} — LINK GRAPH`} onChange={syncGraph} />

          {/* Notes */}
          <div className="terminal-card p-4 space-y-2">
            <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)]">ANALYST NOTES</div>
            <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={5}
              placeholder="Timeline, hypotheses, links between entities…"
              className="terminal-input w-full px-3 py-2 text-sm font-mono resize-y" />
            <button onClick={saveNotes} className="btn-neon flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest">
              <Save className="w-3.5 h-3.5" /> {notesSaved ? "SAVED" : "SAVE NOTES"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
