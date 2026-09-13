"use client";

import { Layers, History, Server, Building2, Share2 } from "lucide-react";
import type { DomainLookupResponse } from "@/lib/types";

/**
 * The four findings domain mode gained: where its subdomain list came from, what
 * the name used to resolve to, what is exposed on the addresses it resolves to
 * now, and which registered company is behind it.
 *
 * They live in one file because they share a shape — a heading, a table, and a
 * scope note saying what the numbers do NOT mean. That last part is the point of
 * each panel: a subdomain count is meaningless without its coverage basis, and a
 * passive-DNS page is a sample of a larger history.
 */

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug">{children}</p>;
}

/** Per-source subdomain counts: 9 from a recent-issuance feed is not 9 subdomains. */
export function SubdomainCoveragePanel({ data }: { data: DomainLookupResponse }) {
  const c = data.subdomainCoverage;
  if (!c) return null;
  return (
    <div className="terminal-card p-4 space-y-2">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5" /> SUBDOMAIN COVERAGE: {c.distinct} distinct
      </div>
      <div className="space-y-1">
        {c.sources.map((s) => (
          <div key={s.source} className="text-[11px] font-mono flex items-center gap-2">
            <span className="w-52 shrink-0" style={{ color: s.ok ? "var(--hv-ink)" : "#fb923c" }}>{s.source}</span>
            <span className="text-[var(--hv-ink-dim)]">{s.ok ? `${s.found} found` : "no answer"}</span>
          </div>
        ))}
      </div>
      <Note>
        {c.capped
          ? `Showing the first ${c.limit} of ${c.distinct}. `
          : ""}
        A source that did not answer contributed nothing, which is not the same as finding nothing. Certificate
        transparency only knows names that were issued a certificate.
      </Note>
    </div>
  );
}

/** What the name resolved to in the past, with first and last seen. */
export function PassiveDnsPanel({ data }: { data: DomainLookupResponse }) {
  const p = data.passiveDns;
  if (!p || p.records.length === 0) return null;
  const shown = p.records.slice(0, 40);
  return (
    <div id="sec-pdns" className="terminal-card p-4 space-y-2 scroll-mt-24">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" /> PASSIVE DNS: {p.total.toLocaleString()} historical records
      </div>
      <div className="max-h-72 overflow-y-auto space-y-0.5">
        {shown.map((r, i) => (
          <div key={`${r.query}-${r.answer}-${i}`} className="text-[11px] font-mono flex items-center gap-2 flex-wrap">
            <span className="text-[var(--hv-ink-dim)] w-14 shrink-0">{r.rrtype}</span>
            <span className="text-[var(--hv-cyan)] break-all">{r.query}</span>
            <span className="text-[var(--hv-ink-dim)]">→</span>
            <span className="text-[var(--hv-ink)] break-all">{r.answer}</span>
            {r.firstSeen && <span className="text-[var(--hv-ink-dim)]">{r.firstSeen} to {r.lastSeen ?? "now"}</span>}
          </div>
        ))}
      </div>
      <Note>
        Historical resolutions, not current ones: an address here may have been abandoned years ago.
        {p.capped ? ` Showing ${shown.length} of ${p.total.toLocaleString()}.` : ""}
        {p.degraded
          ? " The source returned records without their types this time, so a type is shown only where the answer itself proves it."
          : ""}
      </Note>
    </div>
  );
}

/** Open ports, CVEs and scanner reputation for the apex's own addresses. */
export function HostExposurePanel({ data }: { data: DomainLookupResponse }) {
  const hosts = (data.hostExposure ?? []).filter(
    (h) => h.ports || h.vulns || h.tags || h.greyNoise,
  );
  if (hosts.length === 0) return null;
  return (
    <div id="sec-exposure" className="terminal-card p-4 space-y-2 scroll-mt-24">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <Server className="w-3.5 h-3.5" /> HOST EXPOSURE: this domain&apos;s own addresses
      </div>
      {hosts.map((h) => (
        <div key={h.ip} className="rounded-md border border-[var(--hv-glass-border)] p-2.5 space-y-1">
          <div className="text-xs font-mono text-[var(--hv-cyan)] break-all">{h.ip}</div>
          {h.ports && <div className="text-[11px] font-mono text-[var(--hv-ink)]">ports: {h.ports.join(", ")}</div>}
          {h.vulns && (
            <div className="text-[11px] font-mono text-[#ff4d6d]">
              CVEs on exposed services: {h.vulns.slice(0, 12).join(", ")}{h.vulns.length > 12 ? ` +${h.vulns.length - 12} more` : ""}
            </div>
          )}
          {h.tags && <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">tags: {h.tags.join(", ")}</div>}
          {h.greyNoise && (
            <div className="text-[11px] font-mono text-[#fb923c]">
              GreyNoise: {h.greyNoise.classification}{h.greyNoise.name ? ` (${h.greyNoise.name})` : ""}
            </div>
          )}
        </div>
      ))}
      <Note>
        Read from Shodan InternetDB and GreyNoise for the addresses this domain resolves to. A CVE here is a service
        banner matching a known vulnerability, not a confirmed exploitable finding.
      </Note>
    </div>
  );
}

/** Other domains on the same address: shared hosting, or a related estate. */
export function ReverseIpPanel({ data }: { data: DomainLookupResponse }) {
  const r = data.reverseIp;
  if (!r || r.hosts.length === 0) return null;
  return (
    <div id="sec-cohosted" className="terminal-card p-4 space-y-2 scroll-mt-24">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <Share2 className="w-3.5 h-3.5" /> CO-HOSTED: {r.total.toLocaleString()} names on {r.ip}
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto">
        {r.hosts.map((h) => (
          <a key={h} href={`?mode=domain&q=${encodeURIComponent(h)}`} target="_blank" rel="noopener noreferrer"
            className="text-[11px] font-mono px-2 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors">
            {h}
          </a>
        ))}
      </div>
      <Note>
        Names seen on the same address. On shared hosting or a CDN that means nothing about their owners; on dedicated
        infrastructure it usually maps an estate. {r.total > r.hosts.length ? `Showing ${r.hosts.length} of ${r.total}.` : ""}
      </Note>
    </div>
  );
}

/** The registered company behind the domain, from the global LEI register. */
export function LeiPanel({ data }: { data: DomainLookupResponse }) {
  const lei = data.lei;
  if (!lei || lei.records.length === 0) return null;
  const exact = lei.records.filter((r) => r.exact);
  const others = lei.records.filter((r) => !r.exact);
  return (
    <div id="sec-lei" className="terminal-card p-4 space-y-2 scroll-mt-24">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <Building2 className="w-3.5 h-3.5" /> LEGAL ENTITY: {lei.query}
      </div>
      {exact.map((r) => (
        <div key={r.lei} className="rounded-md border border-[var(--hv-glass-border)] p-2.5 space-y-0.5">
          <div className="text-xs font-mono text-[var(--hv-ink)] font-bold">{r.legalName}</div>
          <div className="text-[11px] font-mono text-[var(--hv-cyan)]">LEI {r.lei}</div>
          {r.registeredAs && <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">company number {r.registeredAs}</div>}
          {r.legalAddress && <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">{r.legalAddress}</div>}
          <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
            registration {r.status ?? "unknown"} · entity {r.entityStatus ?? "unknown"}
          </div>
        </div>
      ))}
      {others.length > 0 && (
        <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
          similar names in the register: {others.map((r) => r.legalName).join("; ")}
        </div>
      )}
      <Note>
        Queried with the organisation named by {lei.source === "registrant" ? "the domain's WHOIS registrant" : "its OV/EV TLS certificate"}.
        The register matches on words, so only an exact name match identifies the company; the rest are listed as
        similar names, not as the registrant.
      </Note>
    </div>
  );
}
