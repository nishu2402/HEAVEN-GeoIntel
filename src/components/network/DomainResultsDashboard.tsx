"use client";

import { motion } from "framer-motion";
import {
  Globe, Server, Mail, ShieldCheck, ShieldAlert, ExternalLink, Layers, FileText, Network,
} from "lucide-react";
import type { DomainLookupResponse, DnsRecord } from "@/lib/types";
import Tilt3D from "@/components/shared/Tilt3D";

interface Props { data: DomainLookupResponse; }

function RecordBlock({ title, records, accent }: { title: string; records: DnsRecord[]; accent: string }) {
  if (records.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] uppercase tracking-widest font-mono" style={{ color: accent }}>{title} ({records.length})</div>
      <div className="space-y-1">
        {records.map((r, i) => (
          <div key={`${r.value}-${i}`} className="font-mono text-xs text-[var(--hv-ink)] break-all flex items-baseline gap-2">
            {r.priority != null && <span className="text-[var(--hv-ink-dim)]">{r.priority}</span>}
            <span>{r.value}</span>
            {r.ttl != null && <span className="text-[var(--hv-ink-dim)] text-[10px] ml-auto shrink-0">ttl {r.ttl}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  try { return new Date(d).toISOString().split("T")[0]; } catch { return d; }
}

export default function DomainResultsDashboard({ data }: Props) {
  const { dns, whois, emailSecurity: es, subdomains } = data;
  const dmarcColor = es.dmarcPolicy === "reject" ? "#00ff85" : es.dmarcPolicy === "quarantine" ? "#fbbf24" : es.hasDmarc ? "#fb923c" : "#ff4d6d";

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-4 mt-6">
      <Tilt3D max={5}>
        <div className="terminal-card p-5 space-y-3">
          <div className="flex items-center gap-3">
            <Globe className="w-8 h-8 text-[var(--hv-cyan)]" />
            <div>
              <div className="text-2xl font-bold gradient-text tracking-wider font-mono">{data.domain}</div>
              <div className="text-sm text-[var(--hv-ink-dim)] font-mono mt-0.5">
                {dns.a.length} A · {dns.mx.length} MX · {dns.ns.length} NS · {subdomains.length} subdomains
              </div>
            </div>
          </div>
        </div>
      </Tilt3D>

      {/* Email security posture */}
      <div className="terminal-card p-4 space-y-3">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5"><Mail className="w-3 h-3" /> EMAIL SECURITY POSTURE</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { label: "SPF", ok: es.hasSpf, detail: es.hasSpf ? "Sender policy present" : "No SPF — spoofable" },
            { label: "DMARC", ok: es.hasDmarc, detail: es.hasDmarc ? `policy: ${es.dmarcPolicy ?? "set"}` : "No DMARC — spoofable", color: es.hasDmarc ? dmarcColor : "#ff4d6d" },
            { label: "MX", ok: es.hasMx, detail: es.hasMx ? "Receives mail" : "No mail servers" },
          ].map((c) => (
            <div key={c.label} className="rounded-md border p-3 space-y-1"
              style={{ borderColor: (c.color ?? (c.ok ? "#00ff85" : "#ff4d6d")) + "50", background: (c.color ?? (c.ok ? "#00ff85" : "#ff4d6d")) + "0d" }}>
              <div className="flex items-center gap-1.5 text-sm font-mono font-bold" style={{ color: c.color ?? (c.ok ? "#00ff85" : "#ff4d6d") }}>
                {c.ok ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />} {c.label}
              </div>
              <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">{c.detail}</div>
            </div>
          ))}
        </div>
        {es.spf && <div className="font-mono text-[11px] text-[var(--hv-ink-dim)] break-all border-t border-[var(--hv-glass-border)] pt-2">SPF: {es.spf}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* DNS records */}
        <div className="terminal-card p-4 space-y-3">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5"><Server className="w-3 h-3" /> DNS RECORDS</div>
          <RecordBlock title="A" records={dns.a} accent="var(--hv-green)" />
          <RecordBlock title="AAAA" records={dns.aaaa} accent="var(--hv-green)" />
          <RecordBlock title="MX" records={dns.mx} accent="var(--hv-cyan)" />
          <RecordBlock title="NS" records={dns.ns} accent="var(--hv-magenta)" />
          <RecordBlock title="CNAME" records={dns.cname} accent="var(--hv-cyan)" />
          <RecordBlock title="TXT" records={dns.txt} accent="var(--hv-amber)" />
          {dns.a.length === 0 && dns.mx.length === 0 && dns.ns.length === 0 && (
            <div className="text-[12px] font-mono text-[var(--hv-ink-dim)] italic">No DNS records resolved (NXDOMAIN or DNS timeout).</div>
          )}
        </div>

        {/* WHOIS */}
        <div className="terminal-card p-4 space-y-1">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-2 flex items-center gap-1.5"><FileText className="w-3 h-3" /> WHOIS / RDAP</div>
          {whois ? (
            <>
              {([
                ["Registrar", whois.registrar],
                ["Created", fmtDate(whois.createdDate)],
                ["Updated", fmtDate(whois.updatedDate)],
                ["Expires", fmtDate(whois.expiresDate)],
                ["Registrant", whois.registrantOrg],
              ] as [string, string | null][]).map(([k, v]) => v ? (
                <div key={k} className="flex items-start gap-2 py-1.5 border-b border-[var(--hv-glass-border)] last:border-b-0">
                  <span className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] w-28 shrink-0 pt-0.5">{k}</span>
                  <span className="font-mono text-xs flex-1 text-[var(--hv-ink)]">{v}</span>
                </div>
              ) : null)}
              {whois.statuses.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-2">
                  {whois.statuses.slice(0, 6).map((s, i) => (
                    <span key={`${s}-${i}`} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)]">{s}</span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-[12px] font-mono text-[var(--hv-ink-dim)] italic">WHOIS unavailable for this TLD via RDAP.</div>
          )}
        </div>
      </div>

      {/* Subdomains */}
      {subdomains.length > 0 && (
        <div className="terminal-card p-4 space-y-2">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <Layers className="w-3 h-3" /> SUBDOMAINS — {subdomains.length} via certificate transparency
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto">
            {subdomains.map((s, i) => (
              <a key={`${s}-${i}`} href={`https://${s}`} target="_blank" rel="noopener noreferrer"
                className="text-[11px] font-mono px-2 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors">
                {s}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Pivots */}
      <div className="terminal-card p-4 space-y-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5"><Network className="w-3 h-3" /> DEEPEN — free pivots (no key)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {data.pivots.map((p) => (
            <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
              className="flex items-start gap-2 p-2.5 rounded-md border border-[var(--hv-glass-border)] hover:border-[var(--hv-glass-hi)] transition-all">
              <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-[var(--hv-cyan)]" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--hv-cyan)]">{p.label}</div>
                <div className="text-[12px] text-[var(--hv-ink-dim)] leading-tight">{p.note}</div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
