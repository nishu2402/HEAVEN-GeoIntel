"use client";

import { motion } from "framer-motion";
import { Fingerprint, FileDigit, ShieldCheck, HelpCircle, ExternalLink, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { HashLookupResponse } from "@/lib/types";
import { hashReputation } from "@/lib/analysis/hash";
import CopyLinkButton from "@/components/shared/CopyLinkButton";

interface Props { data: HashLookupResponse }

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--hv-glass-border)] last:border-b-0">
      <span className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] w-32 shrink-0 pt-0.5">{label}</span>
      <span className="font-mono text-xs flex-1 break-all text-[var(--hv-ink)]">{value}</span>
    </div>
  );
}

export default function HashResultsDashboard({ data }: Props) {
  const f = data.facts;
  const rep = f ? hashReputation(f) : null;
  const good = rep?.tone === "good";
  const repColor = good ? "#00ff85" : "var(--hv-amber)";

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-4 mt-6">
      <div className="terminal-card p-5 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Fingerprint className="w-8 h-8 text-[var(--hv-cyan)]" />
            <div className="min-w-0">
              {data.kind && (
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded border tracking-widest text-[var(--hv-cyan)] border-[var(--hv-cyan)]/45 bg-[var(--hv-cyan)]/10 uppercase">{data.kind}</span>
              )}
              <div className="text-sm sm:text-base font-bold gradient-text font-mono break-all mt-1">{data.input}</div>
            </div>
          </div>
          <CopyLinkButton />
        </div>

        {f && rep ? (
          <>
            <div className="border-t border-[var(--hv-glass-border)] pt-3">
              <div className="flex items-center gap-2 flex-wrap">
                {good ? <ShieldCheck className="w-5 h-5" style={{ color: repColor }} /> : <HelpCircle className="w-5 h-5" style={{ color: repColor }} />}
                <span className="text-lg font-mono font-bold" style={{ color: repColor }}>{rep.label}</span>
                {f.trust != null && <span className="text-[11px] font-mono text-[var(--hv-ink-dim)]">trust {f.trust}/100</span>}
              </div>
              <p className="text-[12px] font-mono text-[var(--hv-ink-dim)] leading-snug mt-1.5">{rep.detail}</p>
            </div>
            {f.known && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                <Row label={<span className="inline-flex items-center gap-1"><FileDigit className="w-3 h-3" /> File name</span>} value={f.fileName} />
                <Row label="Product" value={f.productName} />
                <Row label="File size" value={f.fileSize != null ? `${f.fileSize.toLocaleString()} bytes` : null} />
                <Row label="Database" value={f.database} />
                <Row label="MD5" value={f.md5} />
                <Row label="SHA-1" value={f.sha1} />
                <Row label="SHA-256" value={f.sha256} />
              </div>
            )}
          </>
        ) : (
          <div className="border-t border-[var(--hv-glass-border)] pt-3 text-[13px] font-mono text-[var(--hv-amber)] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {data.error ?? "No reputation data."}
          </div>
        )}
      </div>

      <div className="terminal-card p-4 space-y-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5"><FileDigit className="w-3 h-3" /> VERDICT ENGINES: pivot for a malware classification</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {data.pivots.map((p) => (
            <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
              className="flex items-start gap-2 p-2.5 rounded-md border border-[var(--hv-glass-border)] hover:border-[var(--hv-glass-hi)] transition-all">
              <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-[var(--hv-cyan)]" />
              <div className="min-w-0"><div className="text-xs font-bold text-[var(--hv-cyan)]">{p.label}</div><div className="text-[12px] text-[var(--hv-ink-dim)] leading-tight">{p.note}</div></div>
            </a>
          ))}
        </div>
        <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" /> A known-good miss is not a detection. Only a multi-engine verdict can convict a hash.
        </p>
      </div>

      {data.sourceHealth && data.sourceHealth.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-[var(--hv-ink-dim)] px-1">
          <span className="uppercase tracking-widest">Sources:</span>
          {data.sourceHealth.map((s) => (
            <span key={s.source} title={s.error || "ok"} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border"
              style={{ borderColor: (s.ok ? "#00ff85" : "#ff4d6d") + "40", color: s.ok ? "#00ff85" : "#ff4d6d" }}>
              {s.ok ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
              {s.source} · {s.ms}ms{s.ok ? "" : ` · ${s.error}`}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
