"use client";

import { motion } from "framer-motion";
import {
  Globe, Server, Mail, ShieldCheck, ShieldAlert, ExternalLink, Layers, FileText, Network,
} from "lucide-react";
import type { DomainLookupResponse, DnsRecord } from "@/lib/types";
import { domainToIpPivot } from "@/lib/analysis/crossPivots";
import Tilt3D from "@/components/shared/Tilt3D";
import GlanceCard, { type JumpItem } from "@/components/shared/GlanceCard";
import CopyLinkButton from "@/components/shared/CopyLinkButton";
import Term from "@/components/shared/Term";
import HttpPosturePanel, { GRADE_COLOR } from "./HttpPosturePanel";
import EmailPermutations from "./EmailPermutations";
import DomainKnownBreachesPanel from "./DomainKnownBreachesPanel";
import SubdomainTakeoverPanel from "./SubdomainTakeoverPanel";
import TyposquatPanel from "./TyposquatPanel";
import UniversalReportExport from "@/components/shared/UniversalReportExport";
import { buildDomainReport } from "@/lib/analysis/report";

interface Props {
  data: DomainLookupResponse;
  /** Cross-tool pivot: run an IP lookup on the domain's first resolved address. */
  onIpLookup?: (ip: string) => void;
}

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

export default function DomainResultsDashboard({ data, onIpLookup }: Props) {
  const { dns, whois, emailSecurity: es, subdomains } = data;
  const ipPivot = domainToIpPivot([...dns.a, ...dns.aaaa]);
  const dmarcColor = es.dmarcPolicy === "reject" ? "#00ff85" : es.dmarcPolicy === "quarantine" ? "#fbbf24" : es.hasDmarc ? "#fb923c" : "#ff4d6d";

  const glanceTiles = [
    { label: "A records", value: String(dns.a.length), accent: "var(--hv-green)" },
    { label: "MX", value: es.hasMx ? "Yes" : "No", accent: es.hasMx ? undefined : "#fb923c" },
    { label: <Term k="SPF">SPF</Term>, value: es.hasSpf ? "Yes" : "No", accent: es.hasSpf ? undefined : "#ff4d6d" },
    { label: <Term k="DMARC">DMARC</Term>, value: es.dmarcPolicy ?? (es.hasDmarc ? "set" : "None"), accent: dmarcColor },
    { label: "Subdomains", value: String(subdomains.length), accent: "var(--hv-cyan)" },
    ...(data.http
      ? [{ label: "HTTP hdrs", value: data.http.security.grade, accent: GRADE_COLOR[data.http.security.grade] }]
      : []),
  ];
  const jump: JumpItem[] = [
    ...(data.http ? [{ id: "sec-http", label: "HTTP/TLS" }] : []),
    ...((data.knownBreaches?.length ?? 0) > 0 ? [{ id: "sec-domain-breaches", label: "Breaches" }] : []),
    { id: "sec-email", label: "Email sec" },
    { id: "sec-emails", label: "Permutations" },
    { id: "sec-dns", label: "DNS" },
    { id: "sec-whois", label: "WHOIS" },
    ...(subdomains.length > 0 ? [{ id: "sec-subs", label: "Subdomains" }] : []),
    { id: "sec-pivots", label: "Pivots" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-4 mt-6">
      <Tilt3D max={5}>
        <div className="terminal-card p-5 space-y-3">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Globe className="w-8 h-8 text-[var(--hv-cyan)]" />
              <div>
                <div className="text-2xl font-bold gradient-text tracking-wider font-mono">{data.domain}</div>
                <div className="text-sm text-[var(--hv-ink-dim)] font-mono mt-0.5">
                  {dns.a.length} A · {dns.mx.length} MX · {dns.ns.length} NS · {subdomains.length} subdomains
                </div>
                {ipPivot && onIpLookup && (
                  <button
                    type="button"
                    onClick={() => onIpLookup(ipPivot)}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded border border-[var(--hv-orange,#fb923c)]/40 text-[#fb923c] hover:bg-[#fb923c]/10 hover:border-[#fb923c] transition-all"
                  >
                    <Network className="w-3 h-3" /> Look up &ldquo;{ipPivot}&rdquo; as IP →
                  </button>
                )}
              </div>
            </div>
            <CopyLinkButton />
          </div>
        </div>
      </Tilt3D>

      <GlanceCard tiles={glanceTiles} jump={jump} />

      <div className="flex justify-end"><UniversalReportExport model={buildDomainReport(data)} /></div>

      {data.http && <HttpPosturePanel http={data.http} />}

      {/* Dangling-CNAME takeover candidates (self-hides when none). */}
      <SubdomainTakeoverPanel candidates={data.takeoverCandidates} />

      {/* Breaches the offline HIBP catalog records for this domain (self-hides when none). */}
      <section id="sec-domain-breaches" className="scroll-mt-24">
        <DomainKnownBreachesPanel breaches={data.knownBreaches ?? []} domain={data.domain} />
      </section>

      {/* Email security posture */}
      <div id="sec-email" className="terminal-card p-4 space-y-3 scroll-mt-24">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5"><Mail className="w-3 h-3" /> EMAIL SECURITY POSTURE</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { label: "SPF", ok: es.hasSpf, detail: es.hasSpf ? "Sender policy present" : "No SPF: spoofable" },
            { label: "DMARC", ok: es.hasDmarc, detail: es.hasDmarc ? `policy: ${es.dmarcPolicy ?? "set"}` : "No DMARC: spoofable", color: es.hasDmarc ? dmarcColor : "#ff4d6d" },
            { label: "MX", ok: es.hasMx, detail: es.hasMx ? "Receives mail" : "No mail servers" },
          ].map((c) => (
            <div key={c.label} className="rounded-md border p-3 space-y-1"
              style={{ borderColor: (c.color ?? (c.ok ? "#00ff85" : "#ff4d6d")) + "50", background: (c.color ?? (c.ok ? "#00ff85" : "#ff4d6d")) + "0d" }}>
              <div className="flex items-center gap-1.5 text-sm font-mono font-bold" style={{ color: c.color ?? (c.ok ? "#00ff85" : "#ff4d6d") }}>
                {c.ok ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />} <Term k={c.label}>{c.label}</Term>
              </div>
              <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">{c.detail}</div>
            </div>
          ))}
        </div>
        {es.spf && <div className="font-mono text-[11px] text-[var(--hv-ink-dim)] break-all border-t border-[var(--hv-glass-border)] pt-2">SPF: {es.spf}</div>}
      </div>

      <EmailPermutations domain={data.domain} />

      {/* Look-alike / typosquat domains, generated client-side (self-hides when none). */}
      <TyposquatPanel domain={data.domain} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* DNS records */}
        <div id="sec-dns" className="terminal-card p-4 space-y-3 scroll-mt-24">
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
        <div id="sec-whois" className="terminal-card p-4 space-y-1 scroll-mt-24">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-2 flex items-center gap-1.5"><FileText className="w-3 h-3" /> WHOIS / <Term k="RDAP">RDAP</Term></div>
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
          {data.dnssec !== null && (
            <div className="flex items-start gap-2 py-1.5 border-t border-[var(--hv-glass-border)]">
              <span className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] w-28 shrink-0 pt-0.5">DNSSEC</span>
              <span className="font-mono text-xs flex-1" style={{ color: data.dnssec ? "#00ff85" : "#fb923c" }}>
                {data.dnssec ? "Signed (DNSKEY present)" : "Not signed: DNS responses are forgeable"}
              </span>
            </div>
          )}
          {data.wayback?.available && (
            <div className="flex items-start gap-2 py-1.5 border-t border-[var(--hv-glass-border)]">
              <span className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] w-28 shrink-0 pt-0.5">First archived</span>
              <span className="font-mono text-xs flex-1 text-[var(--hv-ink)]">
                <a href={data.wayback.snapshotUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="text-[var(--hv-cyan)] hover:underline">{data.wayback.firstSnapshot}</a>
                <span className="text-[var(--hv-ink-dim)]"> · Wayback Machine</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Subdomains */}
      {subdomains.length > 0 && (
        <div id="sec-subs" className="terminal-card p-4 space-y-2 scroll-mt-24">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <Layers className="w-3 h-3" /> SUBDOMAINS: {subdomains.length} via certificate transparency
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
      <div id="sec-pivots" className="terminal-card p-4 space-y-2 scroll-mt-24">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5"><Network className="w-3 h-3" /> DEEPEN: free pivots (no key)</div>
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
