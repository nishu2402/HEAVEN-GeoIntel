"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AtSign, ExternalLink, CheckCircle2, HelpCircle, Search, Code2 } from "lucide-react";
import type { UsernameLookupResponse, UsernameHit } from "@/lib/types";
import { USERNAME_CATEGORY_META } from "@/lib/data/usernameSites";
import Tilt3D from "@/components/shared/Tilt3D";
import CopyLinkButton from "@/components/shared/CopyLinkButton";
import { safeExternalUrl } from "@/lib/utils";

interface Props { data: UsernameLookupResponse; }

type Filter = "found" | "all";

export default function UsernameResultsDashboard({ data }: Props) {
  const [filter, setFilter] = useState<Filter>("found");

  const shown = useMemo(
    () => data.hits.filter((h) => (filter === "found" ? h.status === "found" : h.status !== "notfound")),
    [data.hits, filter]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, UsernameHit[]>();
    for (const h of shown) {
      const k = h.category;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(h);
    }
    return Array.from(map.entries());
  }, [shown]);

  const pct = data.checked > 0 ? Math.round((data.found / data.checked) * 100) : 0;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-4 mt-6">
      <Tilt3D max={5}>
        <div className="terminal-card p-5 space-y-4">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <AtSign className="w-8 h-8 text-[var(--hv-magenta)]" />
              <div>
                <div className="text-2xl font-bold gradient-text tracking-wider font-mono">@{data.username}</div>
                <div className="text-sm text-[var(--hv-ink-dim)] font-mono mt-0.5">
                  Found on <span className="text-[var(--hv-green)] font-bold">{data.found}</span> of {data.checked} auto-checked sites
                  {data.manual ? <span className="text-[var(--hv-cyan)]"> · {data.manual} to verify manually</span> : null}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold font-mono text-[var(--hv-green)]">{pct}%</div>
              <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)]">presence</div>
            </div>
          </div>
          <div className="w-full h-1.5 bg-[var(--hv-glass-border)] rounded">
            <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }}
              className="h-full rounded" style={{ background: "linear-gradient(90deg,var(--hv-green),var(--hv-cyan))", boxShadow: "0 0 8px var(--hv-green)" }} />
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {(["found", "all"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-[11px] font-mono font-bold uppercase tracking-widest px-3 py-1 rounded border transition-all ${
                  filter === f ? "border-[var(--hv-green)] text-[var(--hv-green)] bg-[var(--hv-green)]/10" : "border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:border-[var(--hv-glass-hi)]"
                }`}>
                {f === "found" ? `FOUND (${data.found})` : `INCLUDE TO-VERIFY`}
              </button>
            ))}
            <CopyLinkButton className="text-[11px] font-mono uppercase tracking-widest px-3 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-all flex items-center gap-1.5" />
          </div>
        </div>
      </Tilt3D>

      {data.githubProfile && (
        <div className="terminal-card p-4">
          <div className="flex items-start gap-3">
            {data.githubProfile.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.githubProfile.avatarUrl} alt="GitHub avatar" className="w-12 h-12 rounded-md border border-[var(--hv-glass-border)] shrink-0" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5 text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)]"><Code2 className="w-3 h-3" /> GITHUB PROFILE — verified account</div>
              <a href={safeExternalUrl(data.githubProfile.htmlUrl)} target="_blank" rel="noopener noreferrer" className="font-mono font-bold text-[var(--hv-cyan)] hover:underline break-all">
                {data.githubProfile.name || data.githubProfile.login} <span className="text-[var(--hv-ink-dim)]">@{data.githubProfile.login}</span>
              </a>
              {data.githubProfile.bio && <div className="text-xs font-mono text-[var(--hv-ink)]">{data.githubProfile.bio}</div>}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1">
                <span className="text-[var(--hv-green)]">{data.githubProfile.publicRepos} repos</span>
                <span>{data.githubProfile.followers} followers</span>
                {data.githubProfile.company && <span>{data.githubProfile.company}</span>}
                {data.githubProfile.location && <span>{data.githubProfile.location}</span>}
                {data.githubProfile.createdAt && <span>since {data.githubProfile.createdAt.slice(0, 4)}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {grouped.map(([cat, hits]) => {
        const meta = USERNAME_CATEGORY_META[cat as keyof typeof USERNAME_CATEGORY_META] ?? { label: cat, color: "#00ff85" };
        return (
          <div key={cat} className="terminal-card p-4 space-y-2">
            <div className="text-[12px] uppercase tracking-widest font-mono" style={{ color: meta.color }}>— {meta.label} — ({hits.length})</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {hits.map((h) => (
                <a key={h.site} href={h.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2.5 rounded-md border transition-all"
                  style={{ borderColor: h.status === "found" ? "var(--hv-green)" : "var(--hv-glass-border)", background: h.status === "found" ? "color-mix(in srgb, var(--hv-green) 7%, transparent)" : "transparent" }}>
                  {h.status === "found"
                    ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-[var(--hv-green)]" />
                    : h.status === "manual"
                    ? <Search className="w-3.5 h-3.5 shrink-0 text-[var(--hv-cyan)]" />
                    : <HelpCircle className="w-3.5 h-3.5 shrink-0 text-[var(--hv-ink-dim)]" />}
                  <span className="text-xs font-mono font-bold flex-1" style={{ color: h.status === "found" ? "var(--hv-ink)" : "var(--hv-ink-dim)" }}>{h.site}</span>
                  {h.status === "unknown" && <span className="text-[10px] font-mono text-[var(--hv-amber)]">UNVERIFIED</span>}
                  {h.status === "manual" && <span className="text-[10px] font-mono text-[var(--hv-cyan)]">VERIFY →</span>}
                  <ExternalLink className="w-3 h-3 text-[var(--hv-ink-dim)]" />
                </a>
              ))}
            </div>
          </div>
        );
      })}

      {shown.length === 0 && (
        <div className="terminal-card p-5 text-center text-[var(--hv-ink-dim)] font-mono text-sm">
          No confirmed accounts. Switch to &ldquo;INCLUDE TO-VERIFY&rdquo; or use the pivots below.
        </div>
      )}

      <div className="terminal-card p-4 space-y-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5"><Search className="w-3 h-3" /> DEEPEN — free pivots</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {data.pivots.map((p) => (
            <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 p-2.5 rounded-md border border-[var(--hv-glass-border)] hover:border-[var(--hv-glass-hi)] transition-all">
              <ExternalLink className="w-3 h-3 shrink-0 text-[var(--hv-cyan)]" />
              <span className="text-xs font-bold text-[var(--hv-cyan)]">{p.label}</span>
            </a>
          ))}
        </div>
        <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1">
          <span className="text-[var(--hv-cyan)]">VERIFY →</span> = sites that can&rsquo;t be checked server-side (JS apps / bot-walls that answer 200 for everyone), so we never guess — open the link to confirm.
          &nbsp;<span className="text-[var(--hv-amber)]">UNVERIFIED</span> = the site blocked our check or returned an ambiguous response.
        </p>
      </div>
    </motion.div>
  );
}
