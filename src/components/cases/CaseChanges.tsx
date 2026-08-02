"use client";

import { useMemo } from "react";
import { History, ArrowRight } from "lucide-react";
import type { CaseSnapshot, EntityKind } from "@/lib/types";
import { diffFacts } from "@/lib/analysis/caseSnapshot";

interface Props {
  snapshots: CaseSnapshot[];
}

const KIND_COLOR: Record<EntityKind, string> = {
  phone: "#00ff85", email: "#22d3ee", username: "#e879f9", ip: "#fb923c", domain: "#facc15",
};

const fmt = (at: number) => new Date(at).toLocaleString();

/**
 * "What changed since last time" — the read-out of the case's snapshot history.
 *
 * Each identifier's snapshots are compared consecutively, so a breach count
 * that grew, a subdomain that appeared, or a port that opened shows up as a
 * row. An identifier with a single snapshot is reported as a BASELINE rather
 * than as "no change": those are different claims, and conflating them would
 * assert stability we never observed.
 */
export default function CaseChanges({ snapshots }: Props) {
  const groups = useMemo(() => {
    const byKey = new Map<string, CaseSnapshot[]>();
    for (const s of snapshots) {
      const key = `${s.kind}:${s.value.toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(s);
    }
    return [...byKey.values()].map((list) => {
      const rows = [];
      for (let i = 1; i < list.length; i++) {
        for (const ch of diffFacts(list[i - 1].facts, list[i].facts)) {
          rows.push({ at: list[i].takenAt, ...ch });
        }
      }
      return { list, rows: rows.reverse() }; // newest change first
    });
  }, [snapshots]);

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" /> CHANGE HISTORY — {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"}
      </div>

      {groups.length === 0 ? (
        <p className="text-[12px] font-mono text-[var(--hv-ink-dim)] leading-snug">
          No snapshots yet. Pin a lookup to this case and the tool records a fingerprint of it;
          pin the same identifier again later and this panel reports exactly what moved.
        </p>
      ) : (
        groups.map(({ list, rows }) => {
          const head = list[0];
          return (
            <div key={`${head.kind}:${head.value}`} className="space-y-1.5">
              <div className="flex items-baseline gap-2 flex-wrap text-xs font-mono">
                <span
                  className="px-1 rounded text-[10px] uppercase tracking-widest"
                  style={{ color: KIND_COLOR[head.kind], border: `1px solid ${KIND_COLOR[head.kind]}55` }}
                >
                  {head.kind}
                </span>
                <span className="text-[var(--hv-ink)] break-all">{head.value}</span>
                <span className="text-[10px] text-[var(--hv-ink-dim)]">
                  {list.length} snapshot{list.length === 1 ? "" : "s"} · latest {fmt(list[list.length - 1].takenAt)}
                </span>
              </div>

              {list.length === 1 ? (
                <div className="text-[11px] font-mono text-[var(--hv-ink-dim)] pl-1">
                  Baseline recorded — nothing to compare against yet.
                </div>
              ) : rows.length === 0 ? (
                <div className="text-[11px] font-mono text-[var(--hv-ink-dim)] pl-1">
                  Nothing changed across {list.length} snapshots.
                </div>
              ) : (
                <div className="space-y-0.5 pl-1">
                  {rows.map((r, i) => (
                    <div key={`${r.at}-${r.fact}-${i}`} className="flex items-baseline gap-2 text-[11px] font-mono flex-wrap">
                      <span className="text-[var(--hv-ink-dim)] tabular-nums shrink-0">{fmt(r.at)}</span>
                      <span className="text-[var(--hv-ink)]">{r.fact}</span>
                      <span className="text-[var(--hv-ink-dim)] opacity-70">{String(r.from ?? "—")}</span>
                      <ArrowRight className="w-3 h-3 shrink-0 text-[var(--hv-ink-dim)]" />
                      <span className="text-[var(--hv-green)]">{String(r.to ?? "—")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
