"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AtSign, ExternalLink, CheckCircle2, HelpCircle, Search, Fingerprint, MapPin, Terminal, Copy, Check,
} from "lucide-react";
import type { UsernameLookupResponse, UsernameHit, SocialProfile } from "@/lib/types";
import { USERNAME_CATEGORY_META } from "@/lib/data/usernameSites";
import Tilt3D from "@/components/shared/Tilt3D";
import CopyLinkButton from "@/components/shared/CopyLinkButton";
import LeakCheckPanel from "@/components/breach/LeakCheckPanel";
import { safeExternalUrl } from "@/lib/utils";

interface Props { data: UsernameLookupResponse; }

type Filter = "found" | "all";

function catColor(cat: string): string {
  return USERNAME_CATEGORY_META[cat as keyof typeof USERNAME_CATEGORY_META]?.color ?? "#00ff85";
}

/** Small inline "copy this text" button (for CLI commands). */
function CopyText({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
      }}
      className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] transition-colors shrink-0"
      aria-label={`Copy ${label}`}
    >
      {done ? <Check className="w-3 h-3 text-[var(--hv-green)]" /> : <Copy className="w-3 h-3" />}
      {done ? "COPIED" : "COPY"}
    </button>
  );
}

/** Hides itself if the avatar URL is unsafe or fails to load (CSP-blocked / 404). */
function Avatar({ url, size }: { url: string; size: string }) {
  const [ok, setOk] = useState(true);
  const safe = safeExternalUrl(url);
  if (!ok || !safe) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={safe} alt="" onError={() => setOk(false)}
      className={`${size} rounded-md border border-[var(--hv-glass-border)] shrink-0 object-cover`} />
  );
}

function ProfileCard({ p }: { p: SocialProfile }) {
  const color = catColor(p.category);
  return (
    <div className="rounded-md border border-[var(--hv-glass-border)] p-3 flex items-start gap-3"
      style={{ background: `color-mix(in srgb, ${color} 5%, transparent)` }}>
      {p.avatarUrl && <Avatar url={p.avatarUrl} size="w-11 h-11" />}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ color, border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
            {p.platform}
          </span>
          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--hv-green)]" />
        </div>
        <a href={safeExternalUrl(p.url)} target="_blank" rel="noopener noreferrer"
          className="block font-mono font-bold text-[var(--hv-cyan)] hover:underline break-all leading-tight">
          {p.displayName || p.handle}
          {p.displayName && <span className="text-[var(--hv-ink-dim)] font-normal"> @{p.handle}</span>}
        </a>
        {p.bio && <div className="text-xs font-mono text-[var(--hv-ink)] line-clamp-3">{p.bio}</div>}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono text-[var(--hv-ink-dim)] pt-0.5">
          {p.stats.map((s) => (
            <span key={s.label}><span className="text-[var(--hv-green)] font-bold">{s.value}</span> {s.label}</span>
          ))}
          {p.location && <span className="inline-flex items-center gap-0.5"><MapPin className="w-3 h-3" />{p.location}</span>}
          {p.extra && <span className="text-[var(--hv-amber)]">{p.extra}</span>}
          {p.joinedYear && <span>since {p.joinedYear}</span>}
        </div>
      </div>
      <ExternalLink className="w-3 h-3 text-[var(--hv-ink-dim)] shrink-0 mt-1" />
    </div>
  );
}

export default function UsernameResultsDashboard({ data }: Props) {
  const [filter, setFilter] = useState<Filter>("found");

  const shown = useMemo(
    () => data.hits.filter((h) => (filter === "found" ? h.status === "found" : h.status !== "notfound")),
    [data.hits, filter]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, UsernameHit[]>();
    for (const h of shown) {
      if (!map.has(h.category)) map.set(h.category, []);
      map.get(h.category)!.push(h);
    }
    return Array.from(map.entries());
  }, [shown]);

  // Confirmed = every account we can stand behind: rich API profiles + sweep hits.
  const confirmed = data.found + data.profiles.length;
  const rate = data.checked > 0 ? Math.round((data.found / data.checked) * 100) : 0;
  const identity = data.identity;
  const hasIdentity = identity.names.length + identity.locations.length + identity.avatars.length > 0;

  // Quick category tally across confirmed accounts (rich profiles + sweep hits).
  const catTally = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data.profiles) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    for (const h of data.hits) if (h.status === "found") m.set(h.category, (m.get(h.category) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [data.profiles, data.hits]);

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
                  <span className="text-[var(--hv-green)] font-bold">{confirmed}</span> confirmed{" "}
                  {confirmed === 1 ? "account" : "accounts"}
                  {data.profiles.length > 0 && <span className="text-[var(--hv-cyan)]"> · {data.profiles.length} rich profile{data.profiles.length === 1 ? "" : "s"}</span>}
                  {data.manual ? <span className="text-[var(--hv-amber)]"> · {data.manual} to verify manually</span> : null}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold font-mono text-[var(--hv-green)]">{confirmed}</div>
              <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)]">confirmed</div>
            </div>
          </div>

          {catTally.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {catTally.map(([cat, n]) => {
                const meta = USERNAME_CATEGORY_META[cat as keyof typeof USERNAME_CATEGORY_META];
                const color = meta?.color ?? "#00ff85";
                return (
                  <span key={cat} className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded"
                    style={{ color, border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
                    {meta?.label ?? cat} <span className="font-bold">{n}</span>
                  </span>
                );
              })}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)] mb-1">
              <span>sweep hit rate</span><span>{data.found}/{data.checked} sites · {rate}%</span>
            </div>
            <div className="w-full h-1.5 bg-[var(--hv-glass-border)] rounded">
              <motion.div initial={{ width: 0 }} animate={{ width: `${rate}%` }} transition={{ duration: 0.8 }}
                className="h-full rounded" style={{ background: "linear-gradient(90deg,var(--hv-green),var(--hv-cyan))", boxShadow: "0 0 8px var(--hv-green)" }} />
            </div>
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

      {hasIdentity && (
        <div className="terminal-card p-4 space-y-3">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-magenta)] flex items-center gap-1.5">
            <Fingerprint className="w-3.5 h-3.5" /> IDENTITY SIGNALS — synthesised from verified profiles
          </div>
          {identity.avatars.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {identity.avatars.map((a) => <Avatar key={a.url} url={a.url} size="w-10 h-10" />)}
            </div>
          )}
          {identity.names.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-[var(--hv-ink-dim)] font-mono">name candidates</div>
              <div className="flex flex-wrap gap-1.5">
                {identity.names.map((n) => (
                  <span key={`${n.value}-${n.source}`} className="text-xs font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] bg-[var(--hv-glass)]">
                    <span className="text-[var(--hv-ink)] font-bold">{n.value}</span>
                    <span className="text-[var(--hv-ink-dim)]"> · {n.source}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {identity.locations.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-[var(--hv-ink-dim)] font-mono">location candidates</div>
              <div className="flex flex-wrap gap-1.5">
                {identity.locations.map((l) => (
                  <span key={`${l.value}-${l.source}`} className="text-xs font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] bg-[var(--hv-glass)] inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-[var(--hv-cyan)]" />
                    <span className="text-[var(--hv-ink)]">{l.value}</span>
                    <span className="text-[var(--hv-ink-dim)]"> · {l.source}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {data.profiles.length > 0 && (
        <div className="terminal-card p-4 space-y-2">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-green)] flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> VERIFIED PROFILES ({data.profiles.length}) — API-confirmed
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.profiles.map((p) => <ProfileCard key={p.platform} p={p} />)}
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

      {shown.length === 0 && data.profiles.length === 0 && (
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

        <div className="pt-2 space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] font-mono flex items-center gap-1.5">
            <Terminal className="w-3 h-3" /> CLI deep sweep — run locally for 400+ sites
          </div>
          {[`sherlock ${data.username}`, `maigret ${data.username}`].map((cmd) => (
            <div key={cmd} className="flex items-center gap-2 rounded-md border border-[var(--hv-glass-border)] bg-[var(--hv-bg)]/40 px-3 py-2">
              <span className="text-[var(--hv-green)] font-mono text-xs shrink-0">$</span>
              <code className="text-xs font-mono text-[var(--hv-ink)] flex-1 break-all">{cmd}</code>
              <CopyText text={cmd} label={cmd} />
            </div>
          ))}
        </div>

        <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1">
          <span className="text-[var(--hv-cyan)]">VERIFY →</span> = sites that can&rsquo;t be checked server-side (JS apps / bot-walls that answer 200 for everyone), so we never guess — open the link to confirm.
          &nbsp;<span className="text-[var(--hv-amber)]">UNVERIFIED</span> = the site blocked our check or returned an ambiguous response.
        </p>
      </div>

      {/* Breach exposure for the handle itself — keyless, so it renders on every
          username sweep rather than only when a key is configured. */}
      <LeakCheckPanel source={data.leakCheck} subject="username" />
    </motion.div>
  );
}
