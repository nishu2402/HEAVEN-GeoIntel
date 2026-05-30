"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Share2, Smartphone, Mail, AtSign, Globe, Network } from "lucide-react";
import type { EntityKind } from "@/lib/types";

export interface GraphEntity { kind: EntityKind; value: string; }

interface Props {
  entities: GraphEntity[];
  title?: string;
}

const KIND_META: Record<EntityKind, { color: string; label: string }> = {
  phone:    { color: "#00ff85", label: "PHONE" },
  email:    { color: "#22d3ee", label: "EMAIL" },
  username: { color: "#e879f9", label: "USERNAME" },
  ip:       { color: "#fb923c", label: "IP" },
  domain:   { color: "#facc15", label: "DOMAIN" },
};

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

export default function LinkGraph({ entities, title = "INVESTIGATION GRAPH" }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

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

  function exportPng() {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const svg64 = btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W * 2; canvas.height = H * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#05060d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement("a");
      a.download = `geointel-graph-${Date.now()}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = `data:image/svg+xml;base64,${svg64}`;
  }

  if (entities.length === 0) {
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

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Share2 className="w-3.5 h-3.5" /> {title} — {entities.length} node{entities.length === 1 ? "" : "s"}
        </div>
        <button onClick={exportPng}
          className="btn-neon flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-widest px-2.5 py-1">
          <Download className="w-3 h-3" /> PNG
        </button>
      </div>

      <div className="overflow-x-auto">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480, maxHeight: 480 }}
          xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.1" />
            </radialGradient>
          </defs>

          {/* edges */}
          {nodes.map((n, i) => (
            <line key={`e-${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y}
              stroke={n.color} strokeWidth={hover === i ? 2.5 : 1.2}
              strokeOpacity={hover === null || hover === i ? 0.8 : 0.2} />
          ))}

          {/* central subject node */}
          <circle cx={cx} cy={cy} r={34} fill="url(#coreGlow)" />
          <circle cx={cx} cy={cy} r={22} fill="#0b0e1c" stroke="#22d3ee" strokeWidth={2} />
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontFamily="monospace" fill="#22d3ee" fontWeight="bold">TARGET</text>

          {/* entity nodes */}
          {nodes.map((n, i) => {
            const dim = hover !== null && hover !== i;
            const label = n.value.length > 22 ? n.value.slice(0, 21) + "…" : n.value;
            return (
              <g key={`n-${i}`} opacity={dim ? 0.35 : 1}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
                <circle cx={n.x} cy={n.y} r={hover === i ? 13 : 10} fill="#0b0e1c" stroke={n.color} strokeWidth={2}>
                  {hover === i && <animate attributeName="r" values="10;13;10" dur="1.2s" repeatCount="indefinite" />}
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
