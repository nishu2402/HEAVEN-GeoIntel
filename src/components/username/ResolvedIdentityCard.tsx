"use client";

import { useState } from "react";
import { UserCheck, MapPin, Users } from "lucide-react";
import type { IdentitySignals } from "@/lib/types";
import { resolveIdentity } from "@/lib/analysis/identityResolve";

/**
 * The single most-likely identity distilled from cross-profile signals, with a
 * confidence driven by how many platforms corroborate the name. Self-hides when
 * there is nothing to resolve. Every value shown came from a real profile.
 */
export default function ResolvedIdentityCard({ identity }: { identity: IdentitySignals }) {
  const [avatarOk, setAvatarOk] = useState(true);
  const r = resolveIdentity(identity);
  if (!r.name && !r.location && !r.avatar) return null;

  const color = r.label === "high" ? "#00ff85" : r.label === "medium" ? "#fbbf24" : "#fb923c";

  return (
    <div className="terminal-card p-4 space-y-3 border" style={{ borderColor: color + "40" }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest flex items-center gap-1.5" style={{ color }}>
          <UserCheck className="w-3.5 h-3.5" /> MOST-LIKELY IDENTITY
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-[var(--hv-ink-dim)]">confidence</span>
          <span className="font-mono font-bold text-sm" style={{ color }}>{r.confidence}</span>
          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded border tracking-widest" style={{ color, borderColor: color + "60", background: color + "16" }}>{r.label.toUpperCase()}</span>
        </div>
      </div>
      <div className="w-full h-1.5 bg-[var(--hv-glass-border)] rounded">
        <div className="h-full rounded" style={{ width: `${r.confidence}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {r.avatar && avatarOk && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.avatar.value} alt="avatar" onError={() => setAvatarOk(false)}
            className="w-12 h-12 rounded-full border border-[var(--hv-glass-border)] object-cover" />
        )}
        <div className="min-w-0 space-y-1">
          {r.name && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold gradient-text font-mono">{r.name.value}</span>
              <span className="text-[10px] font-mono text-[var(--hv-ink-dim)] flex items-center gap-1">
                <Users className="w-2.5 h-2.5" /> {r.name.agreement}/{r.name.total} platform{r.name.total === 1 ? "" : "s"} agree
              </span>
            </div>
          )}
          {r.location && (
            <div className="text-[12px] font-mono text-[var(--hv-cyan)] flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {r.location.value}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
