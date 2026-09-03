"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderPlus, Trash2, Plus, X, Save, FolderOpen, Loader2, RefreshCw,
  Download, FileText, Upload, ShieldAlert, Printer, Link2, Clock, GitMerge,
} from "lucide-react";
import type { InvestigationCase, EntityKind } from "@/lib/types";
import { correlateCases } from "@/lib/analysis/caseCorrelation";
import { caseTimeline } from "@/lib/analysis/caseTimeline";
import { LOOKUP_MODES } from "@/lib/client/modes";
import LinkGraph, { type GraphEntity } from "@/components/graph/LinkGraph";
import CaseChanges from "@/components/cases/CaseChanges";
import {
  buildCaseJson, buildCaseMarkdown, verifyCaseImport,
  buildCaseCsv, buildMaltegoCsv, buildStixBundle, buildPrintableHtml,
} from "@/lib/analysis/caseReport";

const KIND_COLOR: Record<EntityKind, string> = {
  phone: "#00ff85", email: "#22d3ee", username: "#e879f9", ip: "#fb923c", domain: "#facc15",
};

// Module-scope (not a component/hook), so Date.now()/DOM use is allowed here.
function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
function caseFileName(name: string, ext: string): string {
  const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "") || "case";
  return `case-${slug}-${Date.now()}.${ext}`;
}
function fmtTime(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    /* v8 ignore next -- an invalid date yields "Invalid Date" rather than throwing; only a runtime lacking Intl data reaches this */
    return String(at);
  }
}

export default function CasesPanel() {
  const [cases, setCases] = useState<InvestigationCase[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Set when CASE_PASSWORD is configured and this browser has no valid unlock
  // cookie. Distinct from loadError: the store is reachable, just sealed.
  const [locked, setLocked] = useState(false);
  const [unlockPw, setUnlockPw] = useState("");
  const [unlockErr, setUnlockErr] = useState("");
  const [newName, setNewName] = useState("");
  const [entKind, setEntKind] = useState<EntityKind>("phone");
  const [entVal, setEntVal] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [draftForId, setDraftForId] = useState<string | null>(null);
  const [mergeSourceId, setMergeSourceId] = useState("");

  const active = cases.find((c) => c.id === activeId) ?? null;
  // Cross-case correlation is a pure derivation of the loaded cases.
  const correlations = useMemo(() => correlateCases(cases), [cases]);

  // A failed load must not render as "No cases yet" — that asserts an empty case
  // list we never actually read. Surface the failure and offer a retry instead.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/cases", { cache: "no-store" });
      if (res.status === 401) { setLocked(true); setCases([]); return; }
      const json = (await res.json()) as { cases: InvestigationCase[] };
      setLocked(false);
      setCases(json.cases ?? []);
      setActiveId((prev) => prev ?? json.cases?.[0]?.id ?? null);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, []);

  // Fetch the case list once on mount — a genuine data-fetching side effect. The
  // rule flags the setLoading(true) inside load(), but fetching on mount is
  // exactly what an effect is for (there is no external store to subscribe to).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  // Reset the editable notes draft when the active case changes. Done during
  // render (React's recommended "adjust state when a prop changes" pattern)
  // rather than in an effect — no extra render pass, no set-state-in-effect.
  const activeIdForDraft = active?.id ?? null;
  if (activeIdForDraft !== draftForId) {
    setDraftForId(activeIdForDraft);
    setNotesDraft(active?.notes ?? "");
  }

  // Every mutation goes through here. A rejected fetch (offline / server down)
  // or a server-side error must never surface as an unhandled promise rejection
  // that leaves the button looking inert — report it and return an empty result
  // so callers skip their success path.
  async function api(body: Record<string, unknown>) {
    let json: { case?: InvestigationCase; error?: string };
    try {
      const res = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      json = (await res.json()) as { case?: InvestigationCase; error?: string };
    } catch {
      ping("Request failed: server unreachable");
      return {};
    }
    if (json.case) {
      setCases((prev) => {
        const exists = prev.some((c) => c.id === json.case!.id);
        return exists ? prev.map((c) => (c.id === json.case!.id ? json.case! : c)) : [json.case!, ...prev];
      });
    } else if (json.error) {
      ping(json.error);
    }
    return json;
  }

  async function unlock() {
    setUnlockErr("");
    try {
      const res = await fetch("/api/cases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock", password: unlockPw }),
      });
      if (!res.ok) { setUnlockErr("Incorrect password"); return; }
      setUnlockPw("");
      setLocked(false);
      await load();
    } catch { setUnlockErr("Request failed: server unreachable"); }
  }

  async function createCase() {
    const j = await api({ action: "create", name: newName });
    if (j.case) { setActiveId(j.case.id); setNewName(""); }
  }
  // Only drop the case from local state once the server confirms the delete —
  // otherwise a failed DELETE hides a case that is still on disk, and it
  // reappears on the next refresh.
  async function removeCase(id: string) {
    try {
      const res = await fetch(`/api/cases?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) { ping("Delete failed"); return; }
    } catch { ping("Delete failed: server unreachable"); return; }
    setCases((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }
  async function addEntity() {
    /* v8 ignore next -- `!active` is unreachable: only rendered inside `{active && …}` */
    if (!active || !entVal.trim()) return;
    await api({ action: "addEntity", id: active.id, kind: entKind, value: entVal.trim() });
    setEntVal("");
  }
  async function removeEntity(kind: EntityKind, value: string) {
    /* v8 ignore next -- unreachable: only rendered inside `{active && …}` */
    if (!active) return;
    await api({ action: "removeEntity", id: active.id, kind, value });
  }
  async function saveNotes() {
    /* v8 ignore next -- unreachable: only rendered inside `{active && …}` */
    if (!active) return;
    await api({ action: "notes", id: active.id, notes: notesDraft });
    setNotesSaved(true); setTimeout(() => setNotesSaved(false), 1500);
  }
  // Editing the graph persists straight into the case: diff the next node set
  // against the current one and fire add/remove (a relabel = remove old + add
  // new). Sequential awaits avoid racing the file-backed store.
  async function syncGraph(next: GraphEntity[]) {
    /* v8 ignore next -- unreachable: only rendered inside `{active && …}` */
    if (!active) return;
    const keyOf = (e: GraphEntity) => `${e.kind}::${e.value.toLowerCase()}`;
    const cur: GraphEntity[] = active.entities.map((e) => ({ kind: e.kind, value: e.value }));
    const nextKeys = new Set(next.map(keyOf));
    const curKeys = new Set(cur.map(keyOf));
    for (const e of cur) if (!nextKeys.has(keyOf(e))) await api({ action: "removeEntity", id: active.id, kind: e.kind, value: e.value });
    for (const e of next) if (!curKeys.has(keyOf(e))) await api({ action: "addEntity", id: active.id, kind: e.kind, value: e.value });
  }

  // ── report export / import + data wipe ─────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const ping = (m: string) => { setFlash(m); setTimeout(() => setFlash(null), 2400); };
  function openImportPicker() {
    /* v8 ignore next -- the ref is always attached to the hidden <input type=file> rendered below */
    fileInputRef.current?.click();
  }

  // Fold another case into the active one: its identifiers + notes merge in and
  // the source case is deleted. Confirmed first (it's destructive). The api()
  // call updates the target in state; we then drop the now-deleted source.
  async function mergeSelected() {
    /* v8 ignore next -- `!active` / `=== active.id` are unreachable: rendered inside `{active && …}` and the source list excludes it */
    if (!active || !mergeSourceId || mergeSourceId === active.id) return;
    const src = cases.find((c) => c.id === mergeSourceId);
    if (!src) return;
    if (!window.confirm(`Merge "${src.name}" into "${active.name}"? "${src.name}" will be deleted.`)) return;
    const j = await api({ action: "merge", id: active.id, sourceId: mergeSourceId });
    if (j.case) {
      setCases((prev) => prev.filter((c) => c.id !== mergeSourceId));
      setMergeSourceId("");
      ping(`Merged "${src.name}" in`);
    }
  }

  // Every export button below lives inside `{active && …}`, so the `!active`
  // guards exist only to narrow the type — they are unreachable at runtime.
  async function exportJson() {
    /* v8 ignore next -- unreachable: only rendered inside `{active && …}` */
    if (!active) return;
    const { json } = await buildCaseJson(active);
    downloadFile(caseFileName(active.name, "json"), json, "application/json");
    ping("JSON exported (integrity-hashed)");
  }
  async function exportMd() {
    /* v8 ignore next -- unreachable: only rendered inside `{active && …}` */
    if (!active) return;
    const md = await buildCaseMarkdown(active);
    downloadFile(caseFileName(active.name, "md"), md, "text/markdown");
    ping("Markdown report exported");
  }
  function exportCsv() {
    /* v8 ignore next -- unreachable: only rendered inside `{active && …}` */
    if (!active) return;
    downloadFile(caseFileName(active.name, "csv"), buildCaseCsv(active), "text/csv");
    ping("CSV exported");
  }
  function exportStix() {
    /* v8 ignore next -- unreachable: only rendered inside `{active && …}` */
    if (!active) return;
    downloadFile(caseFileName(active.name, "stix.json"), buildStixBundle(active), "application/json");
    ping("STIX 2.1 bundle exported");
  }
  function exportMaltego() {
    /* v8 ignore next -- unreachable: only rendered inside `{active && …}` */
    if (!active) return;
    downloadFile(caseFileName(active.name, "maltego.csv"), buildMaltegoCsv(active), "text/csv");
    ping("Maltego CSV exported");
  }
  async function printReport() {
    /* v8 ignore next -- unreachable: only rendered inside `{active && …}` */
    if (!active) return;
    const html = await buildPrintableHtml(active);
    const w = window.open("", "_blank");
    if (!w) { ping("Pop-up blocked: allow pop-ups to print"); return; }
    w.document.write(html); w.document.close();
    ping("Opening printable report…");
  }
  // Three outcomes, and they must never be conflated: the hash matched
  // (verified), the hash was present but wrong (tampered), or there was no hash
  // at all (unverifiable — a hand-written or stripped file). Only the first may
  // be reported to the analyst as verified; the other two require confirmation.
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    /* v8 ignore next -- `files` is never null on an <input type=file>; the `?.` is defensive */
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same filename
    if (!file) return;
    const check = await verifyCaseImport(await file.text());
    // `ok: false` and a missing `case` are the same condition; a rejected check
    // always carries an error message.
    if (!check.case) {
      /* v8 ignore next -- the fallback string is defensive: `error` is always set on failure */
      ping(check.error || "Import failed");
      return;
    }
    if (!check.verified) {
      const warning = check.tampered
        ? "Integrity hash does NOT match: this report may have been modified. Import anyway?"
        : "This report carries no integrity hash, so its contents cannot be verified. Import anyway?";
      if (!window.confirm(warning)) return;
    }
    const j = await api({ action: "import", case: check.case });
    if (!j.case) return;
    setActiveId(j.case.id);
    if (check.verified) ping("Imported: integrity verified");
    else if (check.tampered) ping("Imported: HASH MISMATCH");
    else ping("Imported: UNVERIFIED (no integrity hash)");
  }
  // Same rule as removeCase: only clear local state once the server confirms.
  async function deleteAllData() {
    if (!window.confirm("Delete ALL cases AND the audit log? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/cases?all=1", { method: "DELETE" });
      if (!res.ok) { ping("Wipe failed"); return; }
    } catch { ping("Wipe failed: server unreachable"); return; }
    setCases([]); setActiveId(null); ping("All local data wiped");
  }

  // The store is sealed (CASE_PASSWORD is set and this browser has no valid
  // unlock cookie). Render ONLY the unlock form: no case list, no wipe button,
  // no export — a locked panel must not leak the shape of what it protects.
  if (locked) {
    return (
      <div className="space-y-4 mt-6">
        <div className="terminal-card p-5 space-y-3 max-w-md">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" /> CASE STORE LOCKED
          </div>
          <p className="text-[12px] font-mono text-[var(--hv-ink-dim)] leading-snug">
            This instance sets <code className="text-[var(--hv-cyan)]">CASE_PASSWORD</code>, so saved
            investigations are sealed even though lookups are open. Unlock to continue.
          </p>
          <div className="flex gap-1.5">
            <input
              type="password"
              value={unlockPw}
              onChange={(e) => setUnlockPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }}
              placeholder="case password"
              aria-label="Case password"
              className="terminal-input flex-1 min-w-0 px-2 py-1.5 text-xs font-mono"
            />
            <button
              onClick={unlock}
              disabled={!unlockPw}
              className="px-3 rounded-md border border-[var(--hv-glass-border)] text-[11px] font-mono uppercase tracking-widest text-[var(--hv-cyan)] hover:border-[var(--hv-cyan)] transition-colors disabled:opacity-40"
            >
              Unlock
            </button>
          </div>
          {unlockErr && <div className="text-[11px] font-mono text-[var(--hv-red)]">{unlockErr}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-6">
      {/* Create + list */}
      <div className="terminal-card p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5" /> INVESTIGATION CASES: persistent across sessions
          </div>
          <div className="flex items-center gap-2">
            {flash && <span className="text-[11px] font-mono text-[var(--hv-green)]">{flash}</span>}
            <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={onImportFile} className="hidden" />
            <button onClick={openImportPicker}
              className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors">
              <Upload className="w-3 h-3" /> IMPORT
            </button>
            <button onClick={deleteAllData}
              className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-md border border-[var(--hv-red)]/40 text-[var(--hv-red)] hover:bg-[var(--hv-red)]/10 transition-colors">
              <ShieldAlert className="w-3 h-3" /> WIPE ALL
            </button>
            <button onClick={load} className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)]" aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
          </div>
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
        ) : loadError ? (
          <div className="flex items-center gap-2 text-sm font-mono py-3 text-[var(--hv-red)]">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            Could not load cases: the server is unreachable.
            <button onClick={load} className="underline hover:text-[var(--hv-cyan)]">Retry</button>
          </div>
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

      {/* Cross-case links — identifiers appearing in more than one case */}
      {correlations.length > 0 && (
        <div className="terminal-card p-4 space-y-2">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-cyan)] flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" /> CROSS-CASE LINKS: identifiers shared across investigations
          </div>
          <div className="space-y-1.5">
            {correlations.map((corr) => (
              <div key={`${corr.kind}:${corr.value}`}
                className="flex items-center gap-2 flex-wrap text-xs font-mono py-1.5 border-b border-[var(--hv-glass-border)] last:border-b-0">
                <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border"
                  style={{ color: KIND_COLOR[corr.kind], borderColor: KIND_COLOR[corr.kind] + "60" }}>{corr.kind}</span>
                <span className="text-[var(--hv-ink)] break-all font-bold">{corr.value}</span>
                <span className="text-[var(--hv-ink-dim)]">in {corr.count} cases:</span>
                <span className="flex flex-wrap gap-1">
                  {corr.cases.map((cr) => (
                    <button key={cr.id} onClick={() => setActiveId(cr.id)}
                      className="px-1.5 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:border-[var(--hv-cyan)] hover:text-[var(--hv-cyan)] transition-colors">
                      {cr.name}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {active && (
        <>
          {/* Entities + add */}
          <div className="terminal-card p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)]">
                {active.name}: {active.entities.length} identifier{active.entities.length === 1 ? "" : "s"}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {([
                  ["JSON", exportJson, Download],
                  ["REPORT", exportMd, FileText],
                  ["CSV", exportCsv, FileText],
                  ["STIX", exportStix, FileText],
                  ["MALTEGO", exportMaltego, FileText],
                  ["PRINT/PDF", printReport, Printer],
                ] as [string, () => void, typeof Download][]).map(([label, fn, Icon]) => (
                  <button key={label} onClick={fn}
                    className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest px-2 py-1 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors">
                    <Icon className="w-3 h-3" /> {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={entKind} onChange={(e) => setEntKind(e.target.value as EntityKind)}
                aria-label="Identifier type"
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
              {active.entities.length === 0 && <span className="text-[12px] font-mono text-[var(--hv-ink-dim)]">No identifiers yet: add the phone/email/username/IP/domain you&apos;re investigating.</span>}
            </div>
          </div>

          {/* Merge — fold another case's identifiers + notes into this one */}
          {cases.length > 1 && (
            <div className="terminal-card p-4 space-y-2">
              <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
                <GitMerge className="w-3.5 h-3.5" /> MERGE: fold another case into {active.name}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select value={mergeSourceId} onChange={(e) => setMergeSourceId(e.target.value)}
                  aria-label="Case to merge in"
                  className="terminal-input flex-1 px-3 py-2 text-sm font-mono">
                  <option value="">Select a case to merge in…</option>
                  {cases.filter((c) => c.id !== active.id).map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.entities.length})</option>
                  ))}
                </select>
                <button onClick={mergeSelected} disabled={!mergeSourceId}
                  className="btn-neon flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest disabled:opacity-40">
                  <GitMerge className="w-3.5 h-3.5" /> MERGE IN
                </button>
              </div>
              <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
                Its identifiers and notes fold into <span className="text-[var(--hv-ink)]">{active.name}</span>; the other case is then deleted. Duplicates are kept once (earliest sighting wins).
              </div>
            </div>
          )}

          {/* Graph */}
          <LinkGraph
            entities={active.entities.map((e) => ({ kind: e.kind, value: e.value }))}
            links={active.edges}
            title={`${active.name.toUpperCase()}: LINK GRAPH`}
            onChange={syncGraph}
          />

          <CaseChanges snapshots={active.snapshots ?? []} />

          {/* Timeline — creation, pinned identifiers, derived links and lookup snapshots */}
          {(() => {
            const timeline = caseTimeline(active);
            return (
          <div className="terminal-card p-4 space-y-2">
            <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> TIMELINE: {timeline.length} event{timeline.length === 1 ? "" : "s"}
            </div>
            <div className="space-y-0">
              {timeline.map((ev, i) => (
                <div key={`${ev.at}-${i}`} className="flex items-baseline gap-2.5 py-1 text-xs font-mono">
                  <span className="w-2 h-2 rounded-full shrink-0 self-center"
                    style={{ background: ev.entityKind ? KIND_COLOR[ev.entityKind] : ev.type === "edge" ? "var(--hv-magenta)" : "var(--hv-ink-dim)" }} />
                  <span className="text-[var(--hv-ink-dim)] shrink-0 tabular-nums">{fmtTime(ev.at)}</span>
                  {ev.entityKind && (
                    <span className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: KIND_COLOR[ev.entityKind] }}>{ev.entityKind}</span>
                  )}
                  {ev.type === "edge" && <span className="text-[10px] uppercase tracking-wider shrink-0 text-[var(--hv-magenta)]">link</span>}
                  {ev.type === "snapshot" && <span className="text-[10px] uppercase tracking-wider shrink-0 text-[var(--hv-cyan)]">snapshot</span>}
                  <span className={ev.type === "created" ? "text-[var(--hv-ink-dim)] italic" : "text-[var(--hv-ink)] break-all"}>
                    {ev.label}
                    {ev.detail && <span className="text-[var(--hv-ink-dim)]">: {ev.detail}</span>}
                    {ev.fromCache && <span className="text-[var(--hv-ink-dim)] italic"> (cached)</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
            );
          })()}

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
