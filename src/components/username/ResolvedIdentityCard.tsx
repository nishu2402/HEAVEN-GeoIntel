"use client";

import { useState } from "react";
import { UserCheck, MapPin, Users, Link2, AlertTriangle, HelpCircle } from "lucide-react";
import type { IdentitySignals, LinkProof, ResolvedIdentity } from "@/lib/types";
import { resolveIdentity } from "@/lib/analysis/identityResolve";
import { safeExternalUrl } from "@/lib/utils";

interface Props {
  identity: IdentitySignals;
  /** Server-resolved identity. Absent on a response cached before it existed. */
  resolved?: ResolvedIdentity;
  /** Proofs the server established, used when re-resolving a cached response. */
  proofs?: LinkProof[];
}

/**
 * The most-likely identity, and — the part that matters — what the claim rests
 * on.
 *
 * The card used to show one fused identity per handle, which is how "Portland,
 * OR", "GT" and "Bern" ended up presented as one person's locations. Now the
 * accounts that are PROVEN to be one subject are named, the proof is shown, and
 * values from accounts nothing links to the subject are listed separately as
 * candidates. Self-hides when there is nothing resolved at all.
 */
export default function ResolvedIdentityCard({ identity, resolved, proofs }: Props) {
  const [avatarOk, setAvatarOk] = useState(true);
  const r = resolved ?? resolveIdentity(identity, proofs ?? []);
  if (!r.name && !r.location && !r.avatar) return null;

  const color = r.label === "high" ? "#00ff85" : r.label === "medium" ? "#fbbf24" : "#fb923c";
  const avatarSrc = r.avatar ? safeExternalUrl(r.avatar.value) : undefined;
  const linked = r.cluster.platforms.length > 1;

  return (
    <div className="terminal-card p-4 space-y-3 border" style={{ borderColor: color + "40" }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest flex items-center gap-1.5" style={{ color }}>
          <UserCheck className="w-3.5 h-3.5" /> {linked ? "RESOLVED IDENTITY" : "IDENTITY CANDIDATE"}
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
        {avatarSrc && avatarOk && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarSrc} alt="avatar" onError={() => setAvatarOk(false)}
            className="w-12 h-12 rounded-full border border-[var(--hv-glass-border)] object-cover" />
        )}
        <div className="min-w-0 space-y-1">
          {r.name && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold gradient-text font-mono">{r.name.value}</span>
              <span className="text-[10px] font-mono text-[var(--hv-ink-dim)] flex items-center gap-1">
                <Users className="w-2.5 h-2.5" /> {r.name.agreement}/{r.name.total} linked account{r.name.total === 1 ? "" : "s"} agree
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

      <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
        from {r.cluster.platforms.join(" + ") || "no account"}
      </div>

      {r.cluster.proofs.length > 0 && (
        <div className="space-y-1">
          {r.cluster.proofs.map((p, i) => (
            <div key={i} className="text-[11px] font-mono text-[var(--hv-green)] flex items-start gap-1.5">
              <Link2 className="w-3 h-3 mt-0.5 shrink-0" /> <span>{p.detail}</span>
            </div>
          ))}
        </div>
      )}

      {r.conflicts.length > 0 && (
        <div className="space-y-1">
          {r.conflicts.map((c, i) => (
            <div key={i} className="text-[11px] font-mono text-[#fb923c] flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                linked accounts disagree on {c.field}: {c.values.map((v) => `${v.value} (${v.source})`).join(" vs ")}
              </span>
            </div>
          ))}
        </div>
      )}

      {!linked && (
        <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
          Nothing links these accounts beyond the shared handle, so the identity rests on one account only.
          A popular handle is claimed by different people on different platforms.
        </p>
      )}

      {r.unlinked.length > 0 && (
        <div className="pt-2 border-t border-[var(--hv-glass-border)] space-y-1">
          <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <HelpCircle className="w-3 h-3" /> UNLINKED CANDIDATES ({r.unlinked.length})
          </div>
          {r.unlinked.filter((u) => u.field !== "avatar").map((u, i) => (
            <div key={i} className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
              {u.field}: <span className="text-[var(--hv-ink)]">{u.value}</span> ({u.source})
            </div>
          ))}
          <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
            These came from accounts with the same handle that no proof ties to the subject. Leads to check, not facts.
          </p>
        </div>
      )}
    </div>
  );
}
