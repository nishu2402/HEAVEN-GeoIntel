"use client";

import { useMemo, useRef, useState } from "react";
import {
  Download, Share2, Smartphone, Mail, AtSign, Globe, Network,
  Plus, Trash2, Check, X, Pencil,
} from "lucide-react";
import type { EntityKind } from "@/lib/types";
import { BRAND, logoSvg } from "@/lib/brand/logo";

export interface GraphEntity { kind: EntityKind; value: string; }

/** A derived relationship drawn between two real nodes. */
export interface GraphLink {
  from: GraphEntity;
  to: GraphEntity;
  /** Shown on hover — which source produced the link. */
  reason: string;
}

interface Props {
  entities: GraphEntity[];
  /**
   * Derived relationships to draw BETWEEN nodes. Without these the graph is a
   * plain star (every identifier spoked off the case), which shows membership
   * but not derivation. With them it shows what was actually inferred from
   * what — links whose ends are both present are drawn; the rest are ignored.
   */
  links?: GraphLink[];
  title?: string;
  /**
   * When provided, the graph becomes EDITABLE: click a node to relabel /
   * change type / remove it, and add new nodes. The callback receives the full
   * next list, so the parent stays the single source of truth (controlled).
   */
  onChange?: (next: GraphEntity[]) => void;
}

const KIND_META: Record<EntityKind, { color: string; label: string }> = {
  phone:    { color: "#00ff85", label: "PHONE" },
  email:    { color: "#22d3ee", label: "EMAIL" },
  username: { color: "#e879f9", label: "USERNAME" },
  ip:       { color: "#fb923c", label: "IP" },
  domain:   { color: "#facc15", label: "DOMAIN" },
};

const KIND_ORDER: EntityKind[] = ["phone", "email", "username", "ip", "domain"];

function KindIcon({ kind, className }: { kind: EntityKind; className?: string }) {
  const c = className ?? "w-3 h-3";
  switch (kind) {
    case "phone":    return <Smartphone className={c} />;
    case "email":    return <Mail className={c} />;
    case "username": return <AtSign className={c} />;
    case "ip":       return <Network className={c} />;
    case "domain":   return <Globe className={c} />;
  }
}

export default function LinkGraph({ entities, links, title = "INVESTIGATION GRAPH", onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const editable = typeof onChange === "function";

  // add-node form
  const [addKind, setAddKind] = useState<EntityKind>("phone");
  const [addVal, setAddVal] = useState("");
  // edit-node form (seeded on select)
  const [editKind, setEditKind] = useState<EntityKind>("phone");
  const [editVal, setEditVal] = useState("");

  const W = 720, H = 460, cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 70;

  const nodes = useMemo(() => {
    const n = entities.length;
    return entities.map((e, i) => {
      const angle = n === 1 ? -Math.PI / 2 : (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        ...e,
        x: cx + Math.cos(angle) * R,
        y: cy + Math.sin(angle) * R,
        color: KIND_META[e.kind].color,
      };
    });
  }, [entities, cx, cy, R]);

  // Resolve each link's endpoints to node indices. A link naming an identifier
  // that isn't in the graph (removed since it was derived) is dropped rather
  // than drawn to nowhere.
  const derived = useMemo(() => {
    if (!links || links.length === 0) return [];
    const index = new Map(entities.map((e, i) => [`${e.kind}:${e.value.toLowerCase()}`, i]));
    const out: { a: number; b: number; reason: string }[] = [];
    const seen = new Set<string>();
    for (const l of links) {
      const a = index.get(`${l.from.kind}:${l.from.value.toLowerCase()}`);
      const b = index.get(`${l.to.kind}:${l.to.value.toLowerCase()}`);
      if (a === undefined || b === undefined || a === b) continue;
      const key = `${a}-${b}-${l.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a, b, reason: l.reason });
    }
    return out;
  }, [links, entities]);

  // ── edit helpers (all go through onChange — controlled) ────────────────────
  const isDup = (cand: GraphEntity, skip = -1) =>
    entities.some((x, i) => i !== skip && x.kind === cand.kind && x.value.toLowerCase() === cand.value.trim().toLowerCase());

  function selectNode(i: number) {
    if (!editable) return;
    setSelected(i);
    const e = entities[i];
    /* v8 ignore next -- i comes from a rendered node, so entities[i] is always defined; defensive */
    if (e) { setEditKind(e.kind); setEditVal(e.value); }
  }
  function removeAt(i: number) {
    /* v8 ignore next -- removeAt is only wired when editable (onChange defined); guard is for types */
    if (!onChange) return;
    onChange(entities.filter((_, idx) => idx !== i));
    setSelected(null);
    setHover(null);
  }
  function saveEdit() {
    /* v8 ignore next -- saveEdit only fires from the edit form (editable + a selection); guard is for types */
    if (!onChange || selected === null) return;
    const value = editVal.trim();
    if (!value) return;
    const cand = { kind: editKind, value };
    if (isDup(cand, selected)) { setSelected(null); return; }
    onChange(entities.map((e, idx) => (idx === selected ? cand : e)));
    setSelected(null);
  }
  function addNode() {
    /* v8 ignore next -- addNode is only wired when editable (onChange defined); guard is for types */
    if (!onChange) return;
    const value = addVal.trim();
    if (!value) return;
    const cand = { kind: addKind, value };
    if (isDup(cand)) { setAddVal(""); return; }
    onChange([...entities, cand]);
    setAddVal("");
  }
  function clearAll() {
    /* v8 ignore next -- clearAll is only wired when editable (onChange defined); guard is for types */
    if (!onChange) return;
    onChange([]);
    setSelected(null);
    setHover(null);
  }

  function exportPng() {
    const svg = svgRef.current;
    /* v8 ignore next -- the SVG ref is always attached when the export button can be clicked; defensive */
    if (!svg) return;
    const encode = (markup: string) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`;
    const graph = new Image();
    graph.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W * 2; canvas.height = H * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#05060d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(graph, 0, 0, canvas.width, canvas.height);
      // Stamp the mark into the bitmap. A link chart is the artefact most likely
      // to be pasted into someone else's deck, so it has to stay attributable
      // once it leaves the tool.
      const mark = new Image();
      mark.onload = () => {
        const pad = 24, size = 44;
        const baseline = canvas.height - pad;
        ctx.drawImage(mark, pad, baseline - size, size, size);
        ctx.fillStyle = BRAND.green;
        ctx.font = "700 24px ui-monospace, Menlo, Consolas, monospace";
        ctx.fillText(BRAND.name, pad + size + 14, baseline - 16);
        ctx.fillStyle = "#7fae93";
        ctx.font = "400 15px ui-monospace, Menlo, Consolas, monospace";
        ctx.fillText(new Date().toISOString(), pad + size + 14, baseline - 1);
        const a = document.createElement("a");
        a.download = `geointel-graph-${Date.now()}.png`;
        a.href = canvas.toDataURL("image/png");
        a.click();
      };
      mark.src = encode(logoSvg({ size: 88, idPrefix: "graph" }));
    };
    graph.src = encode(new XMLSerializer().serializeToString(svg));
  }

  // Read-only + empty → original hint. Editable + empty → still show the canvas
  // and the add form so the user can build a graph from scratch.
  if (entities.length === 0 && !editable) {
    return (
      <div className="terminal-card p-8 text-center space-y-2">
        <Share2 className="w-8 h-8 mx-auto text-[var(--hv-ink-dim)]" />
        <div className="text-sm font-mono text-[var(--hv-ink-dim)]">
          No entities yet. Run lookups (phone, email, username, IP, domain) — each becomes a node here,
          or open a saved case to visualise its identifiers.
        </div>
      </div>
    );
  }

  const selKindColor = selected !== null && entities[selected] ? KIND_META[entities[selected].kind].color : "#22d3ee";

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Share2 className="w-3.5 h-3.5" /> {title} — {entities.length} node{entities.length === 1 ? "" : "s"}
          {editable && (
            <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--hv-glass-border)] text-[10px] text-[var(--hv-cyan)]">
              <Pencil className="w-2.5 h-2.5" /> EDITABLE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editable && entities.length > 0 && (
            <button onClick={clearAll}
              className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-red)] hover:border-[var(--hv-red)]/50 transition-colors">
              <Trash2 className="w-3 h-3" /> CLEAR
            </button>
          )}
          <button onClick={exportPng}
            className="btn-neon flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-widest px-2.5 py-1">
            <Download className="w-3 h-3" /> PNG
          </button>
        </div>
      </div>

      {editable && (
        <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
          Click a node to relabel, change its type, or remove it. Add new nodes below.
        </div>
      )}

      <div className="overflow-x-auto">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480, maxHeight: 480 }}
          xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.1" />
            </radialGradient>
          </defs>

          {/* membership spokes — every identifier belongs to this case */}
          {nodes.map((n, i) => (
            <line key={`e-${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y}
              stroke={n.color} strokeWidth={hover === i || selected === i ? 2.5 : 1.2}
              strokeOpacity={
                hover === null || hover === i || selected === i
                  ? (derived.length > 0 ? 0.35 : 0.8)   // recede once real links are drawn
                  : 0.2
              } />
          ))}

          {/* derived links — what the tool actually inferred from what */}
          {derived.map((d, i) => {
            const a = nodes[d.a], b = nodes[d.b];
            const lit = hover === d.a || hover === d.b || selected === d.a || selected === d.b;
            return (
              <line key={`d-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="#22d3ee" strokeWidth={lit ? 2.2 : 1.4} strokeDasharray="5 4"
                strokeOpacity={hover === null && selected === null ? 0.7 : lit ? 0.95 : 0.15}>
                <title>{`${a.value} → ${b.value} · ${d.reason}`}</title>
              </line>
            );
          })}

          {/* central subject node */}
          <circle cx={cx} cy={cy} r={34} fill="url(#coreGlow)" />
          <circle cx={cx} cy={cy} r={22} fill="#0b0e1c" stroke="#22d3ee" strokeWidth={2} />
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontFamily="monospace" fill="#22d3ee" fontWeight="bold">TARGET</text>

          {/* entity nodes */}
          {nodes.map((n, i) => {
            const dim = hover !== null && hover !== i && selected !== i;
            const isSel = selected === i;
            const label = n.value.length > 22 ? n.value.slice(0, 21) + "…" : n.value;
            return (
              <g key={`n-${i}`} opacity={dim ? 0.35 : 1}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                onClick={() => selectNode(i)}
                style={{ cursor: editable ? "pointer" : "default" }}>
                {isSel && (
                  <circle cx={n.x} cy={n.y} r={18} fill="none" stroke={n.color} strokeWidth={1.5}
                    strokeDasharray="3 3" opacity={0.9}>
                    <animateTransform attributeName="transform" type="rotate"
                      from={`0 ${n.x} ${n.y}`} to={`360 ${n.x} ${n.y}`} dur="6s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={n.x} cy={n.y} r={hover === i || isSel ? 13 : 10} fill="#0b0e1c" stroke={n.color} strokeWidth={2}>
                  {hover === i && !isSel && <animate attributeName="r" values="10;13;10" dur="1.2s" repeatCount="indefinite" />}
                </circle>
                <circle cx={n.x} cy={n.y} r={4} fill={n.color} />
                <text x={n.x} y={n.y > cy ? n.y + 26 : n.y - 18} textAnchor="middle"
                  fontSize="11" fontFamily="monospace" fill={n.color} fontWeight="bold">
                  {KIND_META[n.kind].label}
                </text>
                <text x={n.x} y={n.y > cy ? n.y + 39 : n.y - 31} textAnchor="middle"
                  fontSize="10" fontFamily="monospace" fill="#9fb3c8">{label}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── edit controls (only when editable) ─────────────────────────────── */}
      {editable && selected !== null && entities[selected] && (
        <div className="rounded-md border p-2.5 space-y-2"
          style={{ borderColor: selKindColor + "55", background: selKindColor + "0d" }}>
          <div className="text-[11px] font-mono uppercase tracking-widest flex items-center gap-1.5" style={{ color: selKindColor }}>
            <Pencil className="w-3 h-3" /> Editing node #{selected + 1}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={editKind} onChange={(e) => setEditKind(e.target.value as EntityKind)}
              className="terminal-input px-3 py-2 text-sm font-mono" aria-label="Node type">
              {KIND_ORDER.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
            </select>
            <input value={editVal} onChange={(e) => setEditVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setSelected(null); }}
              placeholder="node value" className="terminal-input flex-1 px-3 py-2 text-sm font-mono" autoFocus />
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={!editVal.trim()}
                className="btn-neon flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-bold uppercase tracking-widest disabled:opacity-40">
                <Check className="w-3.5 h-3.5" /> SAVE
              </button>
              <button onClick={() => removeAt(selected)} aria-label="Remove node"
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-bold uppercase tracking-widest rounded-md border border-[var(--hv-red)]/50 text-[var(--hv-red)] hover:bg-[var(--hv-red)]/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> REMOVE
              </button>
              <button onClick={() => setSelected(null)} aria-label="Cancel edit"
                className="px-2 py-2 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)] transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {editable && (
        <div className="flex flex-col sm:flex-row gap-2">
          <select value={addKind} onChange={(e) => setAddKind(e.target.value as EntityKind)}
            className="terminal-input px-3 py-2 text-sm font-mono" aria-label="New node type">
            {KIND_ORDER.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
          </select>
          <input value={addVal} onChange={(e) => setAddVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addNode(); }}
            placeholder="add a node (e.g. +14155552671)" className="terminal-input flex-1 px-3 py-2 text-sm font-mono" />
          <button onClick={addNode} disabled={!addVal.trim()}
            className="btn-neon flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> ADD NODE
          </button>
        </div>
      )}

      {/* legend */}
      <div className="flex flex-wrap gap-2 border-t border-[var(--hv-glass-border)] pt-2">
        {Object.entries(KIND_META).map(([k, m]) => {
          const count = entities.filter((e) => e.kind === k).length;
          if (count === 0) return null;
          return (
            <span key={k} className="flex items-center gap-1.5 text-[11px] font-mono" style={{ color: m.color }}>
              <KindIcon kind={k as EntityKind} /> {m.label} ({count})
            </span>
          );
        })}
      </div>
    </div>
  );
}
