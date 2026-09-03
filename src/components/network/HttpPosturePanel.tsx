"use client";

import { Lock, LockOpen, ShieldCheck, ShieldAlert, Cookie, Cpu, AlertTriangle, CornerDownRight } from "lucide-react";
import type { HttpProbe, TechFingerprint } from "@/lib/types";

// ── Live HTTP + TLS posture ──────────────────────────────────────────────────
//
// Ordered the way an operator reads a target: what am I actually talking to
// (status, title, redirects), how is it defended (header grade), what is it
// built from (fingerprint), and what is it leaking (disclosures, cookies).

/**
 * One colour per header grade. Exported because the domain dashboard paints the
 * same grade on its glance tile; when this lived in both files as a ternary
 * chain, the two could disagree about what a "C" looks like.
 */
export const GRADE_COLOR: Record<HttpProbe["security"]["grade"], string> = {
  A: "#00ff85", B: "#7dd3fc", C: "#fbbf24", D: "#fb923c", F: "#ff4d6d",
};

const KIND_COLOR: Record<TechFingerprint["kind"], string> = {
  server: "#00ff41", cdn: "#00d9ff", cms: "#bf5fff",
  framework: "#ffaa00", language: "#ff6600", hosting: "#7dd3fc", security: "#00ff85",
};

/** Certificate expiry is the one field where the number alone tells the story. */
function expiryColor(days: number | null): string {
  if (days === null) return "var(--hv-ink-dim)";
  if (days < 0) return "#ff4d6d";
  if (days < 14) return "#fb923c";
  if (days < 30) return "#fbbf24";
  return "#00ff85";
}

export default function HttpPosturePanel({ http }: { http: HttpProbe }) {
  const { security: sec, tls } = http;
  const gradeColor = GRADE_COLOR[sec.grade];
  const leaks = http.disclosures.filter((d) => d.hasVersion);
  const weakCookies = http.cookies.filter((c) => !c.secure || !c.httpOnly || !c.sameSite);

  return (
    <div id="sec-http" className="terminal-card p-4 space-y-4 scroll-mt-24">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Lock className="w-3 h-3" /> LIVE HTTP &amp; TLS POSTURE
        </div>
        <div className="font-mono text-[11px] text-[var(--hv-ink-dim)]">
          HTTP {http.status} · {http.url}
        </div>
      </div>

      {http.title && (
        <div className="font-mono text-xs text-[var(--hv-ink)] truncate" title={http.title}>{http.title}</div>
      )}

      {/* Redirects + https upgrade */}
      {(http.redirectChain.length > 0 || http.httpsRedirect !== null) && (
        <div className="space-y-1 border-t border-[var(--hv-glass-border)] pt-2">
          {http.httpsRedirect !== null && (
            <div className="flex items-center gap-1.5 font-mono text-[11px]"
              style={{ color: http.httpsRedirect ? "#00ff85" : "#fb923c" }}>
              {http.httpsRedirect ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
              {http.httpsRedirect
                ? "http:// redirects to https://"
                : "http:// does NOT redirect: a first visit stays in cleartext"}
            </div>
          )}
          {http.redirectChain.map((hop) => (
            <div key={hop} className="flex items-start gap-1.5 font-mono text-[10px] text-[var(--hv-ink-dim)] break-all">
              <CornerDownRight className="w-3 h-3 shrink-0 mt-0.5" />{hop}
            </div>
          ))}
        </div>
      )}

      {/* Header grade */}
      <div className="flex items-start gap-4 border-t border-[var(--hv-glass-border)] pt-3">
        <div className="shrink-0 w-16 h-16 rounded-md flex flex-col items-center justify-center border"
          style={{ borderColor: gradeColor + "60", background: gradeColor + "12", color: gradeColor }}>
          <div className="text-2xl font-bold font-mono leading-none">{sec.grade}</div>
          <div className="text-[10px] font-mono mt-0.5">{sec.percent}%</div>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          {sec.checks.map((c) => (
            <div key={c.name} className="flex items-start gap-1.5 text-[11px] font-mono">
              {c.score === c.max
                ? <ShieldCheck className="w-3 h-3 shrink-0 mt-0.5 text-[#00ff85]" />
                : <ShieldAlert className="w-3 h-3 shrink-0 mt-0.5" style={{ color: c.score > 0 ? "#fbbf24" : "#ff4d6d" }} />}
              <span className="text-[var(--hv-ink)] shrink-0">{c.name}</span>
              <span className="text-[var(--hv-ink-dim)] break-words">({c.note})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Certificate */}
      {tls && (
        <div className="border-t border-[var(--hv-glass-border)] pt-3 space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)]">CERTIFICATE</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
            <div><div className="text-[var(--hv-ink-dim)] text-[10px]">PROTOCOL</div><div className="text-[var(--hv-ink)]">{tls.protocol ?? "—"}</div></div>
            <div><div className="text-[var(--hv-ink-dim)] text-[10px]">ISSUER</div><div className="text-[var(--hv-ink)] truncate" title={tls.issuer ?? ""}>{tls.issuer ?? "—"}</div></div>
            <div><div className="text-[var(--hv-ink-dim)] text-[10px]">EXPIRES</div>
              <div style={{ color: expiryColor(tls.daysRemaining) }}>
                {tls.validTo ?? "—"}{tls.daysRemaining !== null && ` (${tls.daysRemaining}d)`}
              </div>
            </div>
            <div><div className="text-[var(--hv-ink-dim)] text-[10px]">CHAIN</div>
              <div style={{ color: tls.trusted ? "#00ff85" : "#ff4d6d" }}>{tls.trusted ? "trusted" : "UNTRUSTED"}</div>
            </div>
          </div>
          {!tls.trusted && tls.trustError && (
            <div className="flex items-start gap-1.5 font-mono text-[11px] text-[#ff4d6d]">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{tls.trustError}
            </div>
          )}
          {tls.altNames.length > 0 && (
            <div className="font-mono text-[10px] text-[var(--hv-ink-dim)] break-all">
              SAN ({tls.altNames.length}): {tls.altNames.slice(0, 12).join(", ")}{tls.altNames.length > 12 && ` +${tls.altNames.length - 12} more`}
            </div>
          )}
        </div>
      )}

      {/* Technology */}
      {http.tech.length > 0 && (
        <div className="border-t border-[var(--hv-glass-border)] pt-3 space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <Cpu className="w-3 h-3" /> TECHNOLOGY
          </div>
          <div className="flex flex-wrap gap-1.5">
            {http.tech.map((t) => {
              const c = KIND_COLOR[t.kind];
              return (
                <span key={t.name} title={t.evidence}
                  className="font-mono text-[10px] px-2 py-1 rounded border"
                  style={{ borderColor: c + "50", background: c + "0d", color: c }}>
                  {t.name}{t.version && ` ${t.version}`}
                  <span className="text-[var(--hv-ink-dim)]"> · {t.kind}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Disclosure + cookies */}
      {(leaks.length > 0 || weakCookies.length > 0) && (
        <div className="border-t border-[var(--hv-glass-border)] pt-3 space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <Cookie className="w-3 h-3" /> LEAKS
          </div>
          {leaks.map((d) => (
            <div key={d.header} className="font-mono text-[11px] text-[#fb923c] break-all">
              {d.header}: {d.value}: discloses a version an attacker can match to a CVE
            </div>
          ))}
          {weakCookies.map((c) => (
            <div key={c.name} className="font-mono text-[11px] text-[var(--hv-ink-dim)] break-all">
              <span className="text-[#fbbf24]">{c.name}</span> missing{" "}
              {[!c.secure && "Secure", !c.httpOnly && "HttpOnly", !c.sameSite && "SameSite"].filter(Boolean).join(" + ")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
