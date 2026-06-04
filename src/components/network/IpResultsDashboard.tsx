"use client";

import { motion } from "framer-motion";
import {
  MapPin, Shield, AlertTriangle, ExternalLink, Activity, Network,
  Server, Bug, CheckCircle2, XCircle,
} from "lucide-react";
import type { IpLookupResponse } from "@/lib/types";
import Tilt3D from "@/components/shared/Tilt3D";

interface Props { data: IpLookupResponse; }

function ThreatBar({ score, label }: { score: number; label: string }) {
  const color = score >= 70 ? "#ff4d6d" : score >= 40 ? "#fb923c" : score >= 20 ? "#fbbf24" : "#00ff85";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" style={{ color }} /> IP Risk
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono font-bold text-lg" style={{ color }}>{score}</span>
          <span className="text-[12px] font-mono text-[var(--hv-ink-dim)]">/100</span>
          <span className="text-[12px] font-mono font-bold px-2 py-0.5 border tracking-widest rounded"
            style={{ color, borderColor: color + "70", backgroundColor: color + "18" }}>{label}</span>
        </span>
      </div>
      <div className="w-full h-1.5 bg-[var(--hv-glass-border)] rounded">
        <motion.div initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 0.8 }}
          className="h-full rounded" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--hv-glass-border)] last:border-b-0">
      <span className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] w-36 shrink-0 pt-0.5">{label}</span>
      <span className="font-mono text-xs flex-1" style={{ color: accent ?? "var(--hv-ink)" }}>{value}</span>
    </div>
  );
}

function Flag({ on, label }: { on: boolean | null; label: string }) {
  if (on === null) return null;
  const color = on ? "#ff4d6d" : "#00ff85";
  return (
    <span className="text-[12px] font-mono font-bold px-2 py-0.5 border rounded tracking-widest"
      style={{ color, borderColor: color + "70", backgroundColor: color + "16" }}>
      {label}: {on ? "YES" : "NO"}
    </span>
  );
}

export default function IpResultsDashboard({ data }: Props) {
  if (!data.ip) {
    return (
      <div className="terminal-card p-5 border" style={{ borderColor: "#ff4d6d50" }}>
        <div className="text-[13px] uppercase tracking-widest text-[#ff4d6d]/70 mb-2">[ IP LOOKUP FAILED ]</div>
        <div className="font-mono text-sm text-[#ff4d6d]">{data.error ?? "No data"}</div>
      </div>
    );
  }
  const ip = data.ip;
  const mapUrl = ip.latitude != null && ip.longitude != null
    ? `https://www.openstreetmap.org/?mlat=${ip.latitude}&mlon=${ip.longitude}#map=11/${ip.latitude}/${ip.longitude}`
    : null;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-4 mt-6">
      <Tilt3D max={5}>
        <div className="terminal-card p-5 space-y-4">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{ip.flagEmoji ?? "🌐"}</span>
              <div>
                <div className="text-2xl font-bold gradient-text tracking-wider font-mono">{ip.ip}</div>
                <div className="text-sm text-[var(--hv-ink-dim)] mt-0.5 font-mono">
                  {ip.type} · {[ip.city, ip.region, ip.country].filter(Boolean).join(", ") || "Location unknown"}
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-[var(--hv-glass-border)] pt-3"><ThreatBar score={data.threatScore} label={data.threatLabel} /></div>
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[var(--hv-glass-border)]">
            <Flag on={ip.isVpn} label="VPN/PROXY" />
            <Flag on={ip.isHosting} label="HOSTING" />
            <Flag on={ip.isMobile} label="MOBILE" />
            {ip.isTor !== null && <Flag on={ip.isTor} label="TOR" />}
            {ip.greyNoise && (() => {
              const c = ip.greyNoise.classification.toLowerCase();
              const color = c === "malicious" ? "#ff4d6d" : c === "benign" ? "#00ff85" : "#fbbf24";
              return (
                <span className="text-[12px] font-mono font-bold px-2 py-0.5 border rounded tracking-widest"
                  style={{ color, borderColor: color + "70", backgroundColor: color + "16" }}
                  title={ip.greyNoise.name ? `Actor: ${ip.greyNoise.name}` : "GreyNoise Community"}>
                  GREYNOISE: {ip.greyNoise.classification.toUpperCase()}{ip.greyNoise.riot ? " · RIOT" : ""}{ip.greyNoise.noise ? " · SCANNER" : ""}
                </span>
              );
            })()}
          </div>
        </div>
      </Tilt3D>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="terminal-card p-4 space-y-1">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-3 flex items-center gap-1.5"><MapPin className="w-3 h-3" /> GEOLOCATION</div>
          <Row label="City" value={ip.city} accent="var(--hv-cyan)" />
          <Row label="Region" value={ip.region} accent="var(--hv-cyan)" />
          <Row label="Country" value={ip.country ? `${ip.country}${ip.countryCode ? ` (${ip.countryCode})` : ""}` : null} accent="var(--hv-green)" />
          <Row label="Continent" value={ip.continent} />
          <Row label="Postal" value={ip.postal} />
          <Row label="Coordinates" value={ip.latitude != null && ip.longitude != null ? `${ip.latitude}, ${ip.longitude}` : null} />
          <Row label="Timezone" value={ip.timezone ? `${ip.timezone}${ip.utcOffset ? ` (${ip.utcOffset})` : ""}` : null} accent="var(--hv-cyan)" />
          {mapUrl && (
            <a href={mapUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-mono text-[var(--hv-cyan)] hover:underline pt-1">
              <ExternalLink className="w-3 h-3" /> View on OpenStreetMap
            </a>
          )}
        </div>

        <div className="terminal-card p-4 space-y-1">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-3 flex items-center gap-1.5"><Network className="w-3 h-3" /> NETWORK / ASN</div>
          <Row label="ASN" value={ip.asn ? `AS${ip.asn}` : null} accent="var(--hv-green)" />
          <Row label="AS Org" value={ip.asnOrg} accent="var(--hv-green)" />
          <Row label="ISP" value={ip.isp} accent="var(--hv-cyan)" />
          <Row label="Organization" value={ip.org} />
          <Row label="Reverse DNS" value={ip.reverse} accent="var(--hv-magenta)" />
        </div>
      </div>

      {(ip.ports || ip.vulns || ip.hostnames || ip.tags) && (
        <div className="terminal-card p-4 space-y-3">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <Server className="w-3 h-3" /> INTERNET EXPOSURE — Shodan InternetDB
          </div>
          {ip.ports && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-1.5">Open ports ({ip.ports.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {ip.ports.map((p) => (
                  <span key={p} className="font-mono text-[11px] px-2 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)]">{p}</span>
                ))}
              </div>
            </div>
          )}
          {ip.vulns && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#ff4d6d]/80 mb-1.5 flex items-center gap-1"><Bug className="w-3 h-3" /> Known CVEs ({ip.vulns.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {ip.vulns.slice(0, 40).map((v) => (
                  <a key={v} href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(v)}`} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[11px] px-2 py-0.5 rounded border border-[#ff4d6d]/40 text-[#ff4d6d] hover:bg-[#ff4d6d]/10 transition-colors">{v}</a>
                ))}
              </div>
            </div>
          )}
          {ip.hostnames && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-1.5">Hostnames</div>
              <div className="flex flex-wrap gap-1.5">
                {ip.hostnames.map((h) => (
                  <span key={h} className="font-mono text-[11px] px-2 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-magenta)] break-all">{h}</span>
                ))}
              </div>
            </div>
          )}
          {ip.tags && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[var(--hv-glass-border)]">
              {ip.tags.map((t) => (
                <span key={t} className="font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)]">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="terminal-card p-4 space-y-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5"><Shield className="w-3 h-3" /> DEEPEN — free pivots (no key)</div>
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
        <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" /> IP geolocation is ISP-level, not a precise address. Hosting/VPN IPs mask the real user.
        </p>
      </div>

      {data.sources && data.sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-[var(--hv-ink-dim)] px-1">
          <span className="uppercase tracking-widest">Sources:</span>
          {data.sources.map((s) => (
            <span key={s.source} title={s.error || "ok"}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border"
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
