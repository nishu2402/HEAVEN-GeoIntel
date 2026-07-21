"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  User, Mail, Globe, Shield, AlertTriangle, CheckCircle2,
  XCircle, Copy, Check, Download, ExternalLink,
  Building2, Lock, Trash2, Hash, Activity, Briefcase, Phone, AtSign,
} from "lucide-react";
import type { EmailLookupResponse } from "@/lib/types";
import { emailToUsernameCandidate } from "@/lib/data/usernameSites";
import EmailOsintPivots from "@/components/email/EmailOsintPivots";
import BreachPanel      from "@/components/breach/BreachPanel";
import GlanceCard, { type JumpItem } from "@/components/shared/GlanceCard";
import CopyLinkButton from "@/components/shared/CopyLinkButton";
import { cn, copyText, safeExternalUrl } from "@/lib/utils";
import SourceStrip, { type SourceStat, type SourceState } from "@/components/shared/SourceStrip";
import { BRAND, asciiLetterhead } from "@/lib/brand/logo";

interface Props {
  data: EmailLookupResponse;
  /** Cross-tool pivot: run a username sweep on the email's local-part. */
  onUsernameSweep?: (handle: string) => void;
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="flex items-center gap-1 text-xs border border-[#00ff41]/30 px-2 py-1 text-[#00ff41]/70 hover:text-[#00ff41] hover:border-[#00ff41]/60 transition-colors font-mono"
    >
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {done ? "COPIED" : "COPY"}
    </button>
  );
}

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[#00ff41]/10">
      <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/55 w-36 shrink-0 pt-0.5">{label}</span>
      <span className="font-mono text-xs flex-1 break-all" style={{ color: accent ?? "#00ff41" }}>
        {value}
      </span>
    </div>
  );
}

function Badge({ text, color = "#00ff41", bg }: { text: string; color?: string; bg?: string }) {
  return (
    <span
      className="text-[12px] font-mono font-bold px-2 py-0.5 border tracking-widest"
      style={{ color, borderColor: color + "70", backgroundColor: bg ?? color + "18" }}
    >
      {text}
    </span>
  );
}

// ── Threat Score ──────────────────────────────────────────────────────────────
function calcThreatScore(data: EmailLookupResponse): number {
  let score = 0;
  const xon = data.xon?.ok ? data.xon.data : null;
  const rep = data.emailrep?.ok ? data.emailrep.data : null;

  if (xon && xon.breachCount > 0) {
    score += Math.min(xon.breachCount * 10, 30);
    if (xon.breaches.some((b) => b.passwordRisk === "ClearText")) score += 30;
    else if (xon.breaches.some((b) => b.passwordRisk === "EasyToCrack")) score += 20;
    else if (xon.breaches.some((b) => b.xposedData.some((d) => d.toLowerCase().includes("password")))) score += 10;
    const thisYear = new Date().getFullYear();
    if (xon.breaches.some((b) => parseInt(b.xposedDate.slice(0, 4)) >= thisYear - 2)) score += 10;
  }

  if (rep) {
    if (rep.credentialsLeaked) score = Math.max(score, 45);
    if (rep.maliciousActivity) score += 20;
    if (rep.suspicious) score = Math.max(score, 40);
    if (rep.blacklisted) score = Math.max(score, 60);
    if (rep.spam) score += 5;
  }

  if (data.analysis.isDisposable) score = Math.max(score, 20);
  return Math.min(score, 100);
}

function ThreatScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "#ff1a1a" : score >= 40 ? "#ff6600" : score >= 20 ? "#ffaa00" : "#00ff41";
  const label = score >= 70 ? "CRITICAL" : score >= 40 ? "HIGH RISK" : score >= 20 ? "MODERATE" : score > 0 ? "LOW RISK" : "CLEAN";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5" style={{ color }} />
          <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/70">Threat Score</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-lg" style={{ color }}>{score}</span>
          <span className="text-[12px] font-mono text-[#00ff41]/55">/100</span>
          <Badge text={label} color={color} />
        </div>
      </div>
      <div className="w-full h-1.5 bg-[#00ff41]/10 relative">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}60` }}
        />
      </div>
    </div>
  );
}

// ── Report download ───────────────────────────────────────────────────────────
function downloadReport(data: EmailLookupResponse, score: number): void {
  const { email, analysis, gravatar, emailrep, hunter, abstract, xon, breachDirectory, fullContact } = data;
  const sep = "─".repeat(70);
  const now = new Date().toISOString();

  const xonData = xon?.ok ? xon.data : null;

  const lines = [
    asciiLetterhead([
      `${BRAND.name} — Email Intelligence Report`,
      BRAND.tagline,
      ``,
      `Generated   : ${now}`,
      `Threat Score: ${score}/100`,
    ]),
    sep,
    ``,
    `TARGET EMAIL`,
    sep,
    `  Address         : ${email}`,
    `  Username        : ${analysis.username}`,
    `  Domain          : ${analysis.domain}`,
    `  Provider        : ${analysis.providerName} (${analysis.providerType})`,
    `  Disposable      : ${analysis.isDisposable ? "YES" : "No"}`,
    `  Privacy Provider: ${analysis.isPrivacyFocused ? "YES" : "No"}`,
    `  Role Address    : ${analysis.isRoleAddress ? "YES" : "No"}`,
    `  Guessed Name    : ${analysis.guessedName ?? "N/A"}`,
    ``,
    `BREACH DATABASE — XposedOrNot`,
    sep,
    `  Total Breaches  : ${xonData ? xonData.breachCount : "N/A"}`,
    ...(xonData && xonData.breaches.length > 0 ? [
      `  Exposed Data    : ${xonData.xposedDataTypes.join(", ")}`,
      ``,
      `  BREACH LIST:`,
      ...xonData.breaches
        .sort((a, b) => b.xposedDate.localeCompare(a.xposedDate))
        .map((b) => [
          `    [${b.xposedDate.slice(0, 4)}] ${b.breach}${b.domain ? ` (${b.domain})` : ""}`,
          `           Data    : ${b.xposedData.join(", ")}`,
          `           Records : ${b.xposedRecords.toLocaleString()}`,
          `           PW Risk : ${b.passwordRisk}`,
          `           Verified: ${b.verified ? "Yes" : "No"}`,
        ].join("\n")),
    ] : [`  Result          : ${xon?.ok ? "CLEAN — no breaches found" : (xon?.error ?? "N/A")}`]),
    ``,
    `CREDENTIAL HASHES — BreachDirectory`,
    sep,
    ...(breachDirectory?.ok && breachDirectory.data && breachDirectory.data.found > 0 ? [
      `  Records Found   : ${breachDirectory.data.found}`,
      `  Sources         : ${breachDirectory.data.sources.join(", ")}`,
      ``,
      `  CREDENTIAL LIST:`,
      ...breachDirectory.data.results.map((r, i) => [
        `    [${i + 1}] Sources  : ${r.sources.join(", ")}`,
        r.password ? `         Partial  : ${r.password}` : "",
        r.sha1     ? `         SHA-1    : ${r.sha1}` : "",
        r.hash     ? `         MD5      : ${r.hash}` : "",
      ].filter(Boolean).join("\n")),
    ] : [`  Status          : ${
      !breachDirectory?.ok && breachDirectory?.error === "NOT_CONFIGURED"
        ? "NOT CONFIGURED — add RAPIDAPI_KEY to .env.local"
        : breachDirectory?.ok && breachDirectory.data?.found === 0
        ? "CLEAN — no credentials found in BreachDirectory"
        : (breachDirectory?.error ?? "N/A")
    }`]),
    ``,
    `IDENTITY — FullContact Person Enrichment`,
    sep,
    ...(fullContact?.ok && fullContact.data ? [
      `  Full Name       : ${fullContact.data.fullName ?? "N/A"}`,
      `  Title           : ${fullContact.data.title ?? "N/A"}`,
      `  Organization    : ${fullContact.data.organization ?? "N/A"}`,
      `  Location        : ${fullContact.data.location ?? "N/A"}`,
      `  Age             : ${fullContact.data.age ?? "N/A"}`,
      `  Gender          : ${fullContact.data.gender ?? "N/A"}`,
      `  Bio             : ${fullContact.data.bio ?? "N/A"}`,
      fullContact.data.profiles.length > 0
        ? `  Social Profiles : ${fullContact.data.profiles.map((p) => `${p.platform}/${p.username}`).join(", ")}`
        : "",
      fullContact.data.otherEmails.length > 0
        ? `  Other Emails    : ${fullContact.data.otherEmails.join(", ")}`
        : "",
      fullContact.data.phones.length > 0
        ? `  Phone Numbers   : ${fullContact.data.phones.join(", ")}`
        : "",
      ...(fullContact.data.employment.length > 0 ? [
        `  Employment:`,
        ...fullContact.data.employment.map((e) => `    ${e.current ? "[CURRENT]" : "[PAST]"} ${e.name}${e.title ? ` — ${e.title}` : ""}`),
      ] : []),
    ].filter(Boolean) : [
      `  Status          : ${
        fullContact?.error === "NOT_CONFIGURED"
          ? "NOT CONFIGURED — add FULLCONTACT_API_KEY to .env.local"
          : fullContact?.error === "NOT_FOUND"
          ? "No record found for this email"
          : (fullContact?.error ?? "N/A")
      }`,
    ]),
    ``,
    `GRAVATAR PROFILE`,
    sep,
    `  Found           : ${gravatar.found ? "YES" : "No"}`,
    ...(gravatar.found ? [
      `  Display Name    : ${gravatar.displayName ?? "N/A"}`,
      `  Username        : ${gravatar.preferredUsername ?? "N/A"}`,
      `  Location        : ${gravatar.currentLocation ?? "N/A"}`,
      `  About           : ${gravatar.aboutMe ?? "N/A"}`,
      `  Profile URL     : ${gravatar.profileUrl ?? "N/A"}`,
      `  Linked Accounts : ${gravatar.accounts.map((a) => `${a.shortname}:${a.username}`).join(", ") || "None"}`,
    ] : []),
    ``,
    `REPUTATION — EmailRep.io`,
    sep,
    ...(emailrep.ok && emailrep.data ? [
      `  Reputation      : ${emailrep.data.reputation.toUpperCase()}`,
      `  Suspicious      : ${emailrep.data.suspicious ? "YES" : "No"}`,
      `  Credentials Leaked: ${emailrep.data.credentialsLeaked ? "YES — CRITICAL" : "No"}`,
      `  Data Breach     : ${emailrep.data.dataBreach ? "YES" : "No"}`,
      `  Malicious Activity: ${emailrep.data.maliciousActivity ? "YES" : "No"}`,
      `  Spam            : ${emailrep.data.spam ? "YES" : "No"}`,
      `  Deliverable     : ${emailrep.data.deliverable ? "Yes" : "No"}`,
      `  First Seen      : ${emailrep.data.firstSeen ?? "N/A"}`,
      `  Last Seen       : ${emailrep.data.lastSeen ?? "N/A"}`,
      `  Profiles        : ${emailrep.data.profiles.join(", ") || "None"}`,
    ] : [`  Status          : ${emailrep.ok ? "No data" : (emailrep.error ?? "Error")}`]),
    ``,
    `EMAIL VALIDATION — Abstract API`,
    sep,
    ...(abstract.ok && abstract.data ? [
      `  Deliverability  : ${abstract.data.deliverability}`,
      `  Quality Score   : ${(abstract.data.qualityScore * 100).toFixed(0)}%`,
      `  SMTP Valid      : ${abstract.data.isSmtpValid ? "Yes" : "No"}`,
      `  MX Found        : ${abstract.data.isMxFound ? "Yes" : "No"}`,
    ] : [`  Status          : ${abstract.error === "NOT_CONFIGURED" ? "NOT CONFIGURED" : (abstract.error ?? "Error")}`]),
    ``,
    `DELIVERABILITY — Hunter.io`,
    sep,
    ...(hunter.ok && hunter.data ? [
      `  Result          : ${hunter.data.result.toUpperCase()}`,
      `  Confidence      : ${hunter.data.score}/100`,
      `  SMTP Valid      : ${hunter.data.smtpCheck ? "Yes" : "No"}`,
    ] : [`  Status          : ${hunter.error === "NOT_CONFIGURED" ? "NOT CONFIGURED" : (hunter.error ?? "Error")}`]),
    ``,
    sep,
    `Report generated by ${BRAND.name} — for authorized use only.`,
    `All intelligence should be verified before use in assessments.`,
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `email_intel_${email.replace("@", "_at_")}_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

const PROVIDER_COLORS: Record<string, string> = {
  free: "#00d9ff", corporate: "#00ff41", educational: "#00d9ff",
  government: "#ffaa00", privacy: "#888", disposable: "#ff3e3e", unknown: "#555",
};

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  free: <Mail className="w-3 h-3" />,
  corporate: <Building2 className="w-3 h-3" />,
  educational: <Globe className="w-3 h-3" />,
  government: <Shield className="w-3 h-3" />,
  privacy: <Lock className="w-3 h-3" />,
  disposable: <Trash2 className="w-3 h-3" />,
};

// ── Main component ────────────────────────────────────────────────────────────
export default function EmailResultsDashboard({ data, onUsernameSweep }: Props) {
  const { email, analysis, gravatar, emailrep, hunter, abstract, xon, breachDirectory, fullContact } = data;

  // Email → username cross-tool pivot: only when the local-part is a plausible
  // handle and it isn't a generic role inbox (info@, support@…), which is never
  // a person's handle.
  const handleCandidate = analysis.isRoleAddress ? null : emailToUsernameCandidate(email);

  const repData = emailrep.ok ? emailrep.data : null;
  const hunterData = hunter.ok ? hunter.data : null;
  const abstractData = abstract.ok ? abstract.data : null;
  const fcData = fullContact?.ok ? fullContact.data : null;
  /* v8 ignore next -- PROVIDER_COLORS covers every EmailProviderType; the `?? "#00ff41"` is defensive */
  const provColor = PROVIDER_COLORS[analysis.providerType] ?? "#00ff41";

  // Name priority: FullContact (real enrichment) > Gravatar (profile) > inferred from username
  const gravatarName = gravatar.found ? (gravatar.displayName ?? gravatar.preferredUsername) : null;
  const nameToShow = fcData?.fullName ?? gravatarName ?? analysis.guessedName;
  const nameSource: "fullcontact" | "gravatar" | "inferred" | null =
    fcData?.fullName ? "fullcontact" : gravatarName ? "gravatar" : analysis.guessedName ? "inferred" : null;

  // Avatar: prefer FullContact avatar if no Gravatar thumbnail
  const avatarUrl = gravatar.found && gravatar.thumbnailUrl
    ? gravatar.thumbnailUrl
    : (fcData?.avatar ?? null);
  const platforms = repData?.profiles ?? [];
  const threatScore = calcThreatScore(data);

  const srState = (r: { ok: boolean; error?: string }): SourceState =>
    r.ok ? "ok" : r.error === "NOT_CONFIGURED" ? "off" : /not[_ ]?found/i.test(r.error ?? "") ? "empty" : "error";
  const emailSources: SourceStat[] = [
    { source: "Format/MX (offline)", state: "ok" },
    { source: "Gravatar", state: gravatar.found ? "ok" : "empty" },
    { source: "XposedOrNot", state: srState(xon) },
    { source: "EmailRep", state: srState(emailrep) },
    { source: "Hunter.io", state: srState(hunter) },
    { source: "AbstractAPI", state: srState(abstract) },
    { source: "BreachDirectory", state: srState(breachDirectory) },
    /* v8 ignore next -- fullContact is always present on EmailLookupResponse; the "off" fallback is defensive */
    { source: "FullContact", state: fullContact ? srState(fullContact) : "off" },
  ];

  // ── At-a-glance summary + section jump ──
  const xonData = xon?.ok ? xon.data : null;
  const breachCount = xonData ? xonData.breachCount : null;
  const threatColor = threatScore >= 70 ? "#ff1a1a" : threatScore >= 40 ? "#ff6600" : threatScore >= 20 ? "#ffaa00" : "#00ff41";
  const glanceTiles = [
    { label: "Provider", value: analysis.providerType.toUpperCase(), accent: provColor },
    { label: "Disposable", value: analysis.isDisposable ? "Yes" : "No", accent: analysis.isDisposable ? "#ff3e3e" : undefined },
    { label: "Breaches", value: breachCount != null ? (breachCount > 0 ? String(breachCount) : "None") : "—", accent: breachCount && breachCount > 0 ? "#ff3e3e" : undefined },
    { label: "Reputation", value: repData ? repData.reputation.toUpperCase() : "—" },
    { label: "Threat", value: `${threatScore}/100`, accent: threatColor },
  ];
  const jump: JumpItem[] = [
    ...(fcData ? [{ id: "sec-identity", label: "Identity" }] : []),
    { id: "sec-breach", label: "Breach" },
    { id: "sec-class", label: "Classification" },
    { id: "sec-rep", label: "Reputation" },
    { id: "sec-pivots", label: "Pivots" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-4 mt-6"
    >
      {/* ── Identity header ── */}
      <div className="terminal-card p-5 space-y-4">
        <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/70">
          [ EMAIL INTELLIGENCE RESULT ]
        </div>

        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            {avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Profile"
                className="w-14 h-14 rounded-none border border-[#00ff41]/30 shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div>
              {nameToShow && (
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <User className="w-4 h-4 text-[#00d9ff] shrink-0" />
                  <span className="text-xl font-bold text-[#00d9ff] font-mono">{nameToShow}</span>
                  <span className={cn(
                    "text-[12px] font-mono uppercase tracking-widest px-1.5 py-0.5 border",
                    nameSource === "fullcontact"
                      ? "text-[#00d9ff] border-[#00d9ff]/30 bg-[#00d9ff]/5"
                      : nameSource === "gravatar"
                      ? "text-[#00ff41] border-[#00ff41]/30 bg-[#00ff41]/5"
                      : "text-[#888] border-[#888]/30"
                  )}>
                    {nameSource === "fullcontact"
                      ? "✓ FULLCONTACT CONFIRMED"
                      : nameSource === "gravatar"
                      ? "✓ GRAVATAR CONFIRMED"
                      : "INFERRED"}
                  </span>
                </div>
              )}
              <div className="text-xl font-bold glow-green tracking-wider font-mono">{email}</div>
              <div className="text-sm text-[#00ff41]/70 mt-0.5 font-mono">
                {analysis.username} @ {analysis.domain}
              </div>
              {handleCandidate && onUsernameSweep && (
                <button
                  type="button"
                  onClick={() => onUsernameSweep(handleCandidate)}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded border border-[#e879f9]/40 text-[#e879f9] hover:bg-[#e879f9]/10 hover:border-[#e879f9] transition-all"
                >
                  <AtSign className="w-3 h-3" /> Sweep &ldquo;{handleCandidate}&rdquo; as username →
                </button>
              )}
              {(fcData?.location ?? (gravatar.found ? gravatar.currentLocation : null)) && (
                <div className="text-xs text-[#00d9ff]/70 mt-1 font-mono">
                  📍 {fcData?.location ?? gravatar.currentLocation}
                </div>
              )}
              {(fcData?.bio ?? (gravatar.found ? gravatar.aboutMe : null)) && (
                <div className="text-xs text-[#00ff41]/65 mt-1 font-mono italic max-w-md line-clamp-2">
                  &ldquo;{fcData?.bio ?? gravatar.aboutMe}&rdquo;
                </div>
              )}
              {(fcData?.title || fcData?.organization) && (
                <div className="flex items-center gap-1.5 text-xs text-[#00ff41]/70 mt-1 font-mono">
                  <Briefcase className="w-3 h-3 shrink-0" />
                  {fcData.title && fcData.organization
                    ? `${fcData.title} @ ${fcData.organization}`
                    : fcData.title ?? fcData.organization}
                </div>
              )}
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2 items-start">
            <Badge text={analysis.providerType.toUpperCase()} color={provColor} />
            {analysis.isDisposable && <Badge text="DISPOSABLE" color="#ff3e3e" />}
            {analysis.isPrivacyFocused && <Badge text="PRIVACY" color="#888" />}
            {analysis.isRoleAddress && <Badge text="ROLE ADDRESS" color="#ffaa00" />}
            {repData?.suspicious && <Badge text="SUSPICIOUS" color="#ff3e3e" />}
            {repData?.credentialsLeaked && <Badge text="CREDS LEAKED" color="#ff1a1a" />}
            {fcData && <Badge text="FULLCONTACT ✓" color="#00d9ff" />}
            {gravatar.found && <Badge text="GRAVATAR ✓" color="#00ff41" />}
            {data.cachedAt && <Badge text="CACHED" color="#444" />}
          </div>
        </div>

        {/* Threat score */}
        <div className="border-t border-[#00ff41]/10 pt-3">
          <ThreatScoreBar score={threatScore} />
        </div>

        {/* Action row */}
        <div className="flex gap-2 flex-wrap border-t border-[#00ff41]/10 pt-3">
          <CopyBtn text={email} />
          <CopyBtn text={analysis.domain} />
          {gravatar.found && safeExternalUrl(gravatar.profileUrl) && (
            <a
              href={safeExternalUrl(gravatar.profileUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs border border-[#00d9ff]/30 px-2 py-1 text-[#00d9ff]/60 hover:text-[#00d9ff] hover:border-[#00d9ff]/60 transition-colors font-mono"
            >
              <ExternalLink className="w-3 h-3" /> GRAVATAR
            </a>
          )}
          <button
            onClick={() => downloadReport(data, threatScore)}
            className="flex items-center gap-1 text-xs border border-[#00d9ff]/30 px-2 py-1 text-[#00d9ff]/60 hover:text-[#00d9ff] hover:border-[#00d9ff]/60 transition-colors font-mono"
          >
            <Download className="w-3 h-3" /> EXPORT REPORT
          </button>
          <CopyLinkButton />
        </div>
      </div>

      <GlanceCard tiles={glanceTiles} jump={jump} />

      {/* ── FullContact Enrichment Panel — unique data only (name/location/bio already in header) ── */}
      {fcData && (
        fcData.profiles.length > 0 ||
        fcData.otherEmails.length > 0 ||
        fcData.phones.length > 0 ||
        fcData.employment.length > 0 ||
        fcData.age !== null ||
        fcData.gender !== null
      ) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          id="sec-identity"
          className="terminal-card p-5 space-y-4 border-l-2 border-[#00d9ff]/40 scroll-mt-24"
        >
          <div className="flex items-center justify-between">
            <div className="text-[12px] uppercase tracking-widest text-[#00d9ff]/50 flex items-center gap-1.5">
              <User className="w-3 h-3" />
              FULLCONTACT ENRICHMENT — additional identity data
            </div>
            <span className="text-[#00d9ff]/25 font-mono text-[11px]">1,000+ data sources</span>
          </div>

          {/* Age / gender — not shown in header */}
          {(fcData.age !== null || fcData.gender !== null) && (
            <div className="flex flex-wrap gap-1.5">
              {fcData.age !== null && <Badge text={`AGE ~${fcData.age}`} color="#888" />}
              {fcData.gender !== null && <Badge text={fcData.gender.toUpperCase()} color="#888" />}
            </div>
          )}

          {/* Social profiles */}
          {fcData.profiles.length > 0 && (
            <div>
              <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/35 mb-2">SOCIAL PROFILES</div>
              <div className="flex flex-wrap gap-1.5">
                {fcData.profiles.map((p) => (
                  <a
                    key={p.platform + p.username}
                    href={safeExternalUrl(p.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[13px] font-mono border border-[#00d9ff]/30 bg-[#00d9ff]/5 text-[#00d9ff] px-2 py-0.5 hover:border-[#00d9ff]/60 hover:bg-[#00d9ff]/10 transition-colors"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    {p.platform}{p.username ? `: ${p.username}` : ""}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Other emails / linked phones */}
          {(fcData.otherEmails.length > 0 || fcData.phones.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-[#00ff41]/10 pt-3">
              {fcData.otherEmails.length > 0 && (
                <div>
                  <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/35 mb-1.5 flex items-center gap-1">
                    <Mail className="w-2.5 h-2.5" /> OTHER EMAILS
                  </div>
                  {fcData.otherEmails.map((e, i) => (
                    <div key={`${e}-${i}`} className="flex items-center gap-2 text-xs font-mono text-[#00d9ff]/80 py-0.5">
                      {e}
                      <CopyBtn text={e} />
                    </div>
                  ))}
                </div>
              )}
              {fcData.phones.length > 0 && (
                <div>
                  <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/35 mb-1.5 flex items-center gap-1">
                    <Phone className="w-2.5 h-2.5" /> PHONE NUMBERS
                  </div>
                  {fcData.phones.map((p, i) => (
                    <div key={`${p}-${i}`} className="flex items-center gap-2 text-xs font-mono text-[#00d9ff]/80 py-0.5">
                      {p}
                      <CopyBtn text={p} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Employment history */}
          {fcData.employment.length > 0 && (
            <div className="border-t border-[#00ff41]/10 pt-3">
              <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/35 mb-2 flex items-center gap-1">
                <Briefcase className="w-2.5 h-2.5" /> EMPLOYMENT HISTORY
              </div>
              <div className="space-y-1">
                {fcData.employment.slice(0, 5).map((emp, i) => (
                  <div key={`${emp.name}-${emp.title ?? ""}-${i}`} className="flex items-start gap-2 text-xs font-mono">
                    <span className={emp.current ? "text-[#00ff41]" : "text-[#888]"}>
                      {emp.current ? "▶" : "·"}
                    </span>
                    <span className={cn("flex items-center gap-1.5 flex-wrap", emp.current ? "text-[#00ff41]/80" : "text-[#888]")}>
                      {emp.name}{emp.title ? ` — ${emp.title}` : ""}
                      {emp.current && <Badge text="CURRENT" color="#00ff41" />}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── BREACH DATABASE — Primary intelligence ── */}
      <section id="sec-breach" className="scroll-mt-24"><BreachPanel xon={xon} breachDirectory={breachDirectory} /></section>

      {/* ── Risk indicators (EmailRep critical flags) ── */}
      {repData && (repData.credentialsLeaked || repData.dataBreach || repData.suspicious || repData.maliciousActivity) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="terminal-card p-4 border border-[#ff3e3e]/30 bg-[#ff3e3e]/[0.03]"
        >
          <div className="text-[12px] uppercase tracking-widest text-[#ff3e3e]/70 mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> ADDITIONAL RISK FLAGS — EmailRep.io
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {repData.credentialsLeaked && (
              <div className="flex items-start gap-2 text-[13px] font-mono text-[#ff1a1a]">
                <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                Credentials confirmed in breach database
              </div>
            )}
            {repData.dataBreach && !repData.credentialsLeaked && (
              <div className="flex items-start gap-2 text-[13px] font-mono text-[#ff3e3e]">
                <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                Appeared in one or more data breaches
              </div>
            )}
            {repData.maliciousActivity && (
              <div className="flex items-start gap-2 text-[13px] font-mono text-[#ff3e3e]">
                <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                Associated with phishing / spam / fraud
              </div>
            )}
            {repData.suspicious && (
              <div className="flex items-start gap-2 text-[13px] font-mono text-[#ffaa00]">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                Flagged suspicious by reputation engine
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Two-column: Classification + Gravatar ── */}
      <div id="sec-class" className="grid grid-cols-1 lg:grid-cols-2 gap-4 scroll-mt-24">

        {/* Offline classification */}
        <div className="terminal-card p-4 space-y-1">
          <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/70 mb-3 flex items-center gap-1.5">
            {PROVIDER_ICONS[analysis.providerType]}
            EMAIL CLASSIFICATION — offline
          </div>
          <InfoRow label="Provider" value={analysis.providerName} accent={provColor} />
          <InfoRow label="Type" value={analysis.providerType.toUpperCase()} accent={provColor} />
          <InfoRow label="Domain" value={analysis.domain} />
          <InfoRow label="Username" value={analysis.username} />
          <InfoRow label="Disposable" value={analysis.isDisposable ? "YES — THROWAWAY" : "No"} accent={analysis.isDisposable ? "#ff3e3e" : "#00ff41"} />
          <InfoRow label="Privacy" value={analysis.isPrivacyFocused ? "YES — Encrypted / Anonymous" : "No"} accent={analysis.isPrivacyFocused ? "#888" : "#00ff41"} />
          <InfoRow label="Webmail" value={analysis.isWebmail ? "Yes" : "No"} />
          <InfoRow label="Role Address" value={analysis.isRoleAddress ? "YES — generic inbox" : "No"} accent={analysis.isRoleAddress ? "#ffaa00" : "#00ff41"} />
          {analysis.guessedName && (
            <InfoRow label="Inferred Name" value={`${analysis.guessedName} (pattern)`} accent="#00d9ff" />
          )}
        </div>

        {/* Gravatar profile */}
        <div className="terminal-card p-4 space-y-1">
          <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/70 mb-3 flex items-center gap-1.5">
            <User className="w-3 h-3" />
            GRAVATAR PROFILE — real identity
          </div>
          {gravatar.found ? (
            <>
              <InfoRow label="Status" value="PROFILE FOUND" accent="#00ff41" />
              {gravatar.displayName && <InfoRow label="Display Name" value={gravatar.displayName} accent="#00d9ff" />}
              {gravatar.preferredUsername && <InfoRow label="Username" value={gravatar.preferredUsername} accent="#00d9ff" />}
              {gravatar.currentLocation && <InfoRow label="Location" value={gravatar.currentLocation} />}
              {gravatar.aboutMe && <InfoRow label="About" value={gravatar.aboutMe} />}
              {gravatar.profileUrl && <InfoRow label="Profile URL" value={gravatar.profileUrl} />}
              {gravatar.accounts.length > 0 && (
                <div className="pt-2">
                  <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/35 mb-1.5">LINKED ACCOUNTS</div>
                  <div className="flex flex-wrap gap-1.5">
                    {gravatar.accounts.map((acc) => (
                      <a
                        key={acc.shortname + acc.username}
                        href={safeExternalUrl(acc.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[13px] font-mono border border-[#00d9ff]/30 bg-[#00d9ff]/5 text-[#00d9ff] px-2 py-0.5 hover:border-[#00d9ff]/60 transition-colors"
                      >
                        <ExternalLink className="w-2.5 h-2.5" />
                        {acc.shortname}: {acc.username}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6 text-[#00ff41]/65 font-mono text-xs">
              No Gravatar profile — email not linked to a public profile.
            </div>
          )}
        </div>
      </div>

      {/* ── Reputation + Validation ── */}
      <div id="sec-rep" className="grid grid-cols-1 lg:grid-cols-2 gap-4 scroll-mt-24">

        {/* EmailRep.io */}
        <div className="terminal-card p-4 space-y-1">
          <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/70 mb-3 flex items-center gap-1.5">
            <Shield className="w-3 h-3" /> REPUTATION — EmailRep.io
          </div>
          {repData ? (
            <>
              <InfoRow
                label="Reputation"
                value={repData.reputation.toUpperCase()}
                accent={repData.reputation === "high" ? "#00ff41" : repData.reputation === "medium" ? "#ffaa00" : "#ff3e3e"}
              />
              <InfoRow label="Suspicious" value={repData.suspicious ? "YES" : "No"} accent={repData.suspicious ? "#ff3e3e" : "#00ff41"} />
              <InfoRow label="References" value={String(repData.references)} />
              <InfoRow label="Credentials Leaked" value={repData.credentialsLeaked ? "YES" : "No"} accent={repData.credentialsLeaked ? "#ff1a1a" : "#00ff41"} />
              <InfoRow label="Data Breach" value={repData.dataBreach ? "YES" : "No"} accent={repData.dataBreach ? "#ff3e3e" : "#00ff41"} />
              <InfoRow label="Malicious Activity" value={repData.maliciousActivity ? "YES" : "No"} accent={repData.maliciousActivity ? "#ff3e3e" : "#00ff41"} />
              <InfoRow label="Deliverable" value={repData.deliverable ? "Yes" : "No"} accent={repData.deliverable ? "#00ff41" : "#ff3e3e"} />
              <InfoRow label="Primary MX" value={repData.primaryMx ?? "N/A"} />
              <InfoRow label="First Seen" value={repData.firstSeen ?? "N/A"} />
              <InfoRow label="Last Seen" value={repData.lastSeen ?? "N/A"} />
              {platforms.length > 0 && (
                <div className="pt-2">
                  <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/35 mb-1.5">REGISTERED PLATFORMS</div>
                  <div className="flex flex-wrap gap-1.5">
                    {platforms.map((p) => (
                      <span key={p} className="text-[13px] font-mono border border-[#00ff41]/30 bg-[#00ff41]/5 text-[#00ff41] px-2 py-0.5">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6 text-[#888] text-xs font-mono">
              {emailrep.error === "NOT_CONFIGURED"
                ? "Add EMAILREP_API_KEY — free tier available"
                : emailrep.error === "RATE_LIMITED"
                ? "Rate limited — try again shortly"
                : "EmailRep.io did not return data"}
            </div>
          )}
        </div>

        {/* Abstract + Hunter */}
        <div className="space-y-4">
          <div className="terminal-card p-4 space-y-1">
            <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/70 mb-3 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" /> VALIDATION — Abstract API
            </div>
            {abstractData ? (
              <>
                <InfoRow
                  label="Deliverability"
                  value={abstractData.deliverability}
                  accent={abstractData.deliverability === "DELIVERABLE" ? "#00ff41" : "#ff3e3e"}
                />
                <InfoRow label="Quality Score" value={`${(abstractData.qualityScore * 100).toFixed(0)}%`} accent={abstractData.qualityScore > 0.7 ? "#00ff41" : "#ffaa00"} />
                <InfoRow label="SMTP Valid" value={abstractData.isSmtpValid ? "Yes" : "No"} accent={abstractData.isSmtpValid ? "#00ff41" : "#ff3e3e"} />
                <InfoRow label="MX Found" value={abstractData.isMxFound ? "Yes" : "No"} />
                <InfoRow label="Disposable" value={abstractData.isDisposableEmail ? "YES" : "No"} accent={abstractData.isDisposableEmail ? "#ff3e3e" : "#00ff41"} />
                <InfoRow label="Catch-All" value={abstractData.isCatchallEmail ? "Yes" : "No"} />
                {abstractData.autocorrect && <InfoRow label="Did You Mean" value={abstractData.autocorrect} accent="#ffaa00" />}
              </>
            ) : (
              <div className="text-center py-3 text-[#888] text-[13px] font-mono">
                {abstract.error === "NOT_CONFIGURED" ? "Add ABSTRACT_API_KEY — free 250/month" : abstract.error ?? "No data"}
              </div>
            )}
          </div>

          <div className="terminal-card p-4 space-y-1">
            <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/70 mb-3 flex items-center gap-1.5">
              <Hash className="w-3 h-3" /> DELIVERABILITY — Hunter.io
            </div>
            {hunterData ? (
              <>
                <InfoRow
                  label="Result"
                  value={hunterData.result.toUpperCase()}
                  accent={hunterData.result === "deliverable" ? "#00ff41" : hunterData.result === "risky" ? "#ffaa00" : "#ff3e3e"}
                />
                <InfoRow label="Confidence" value={`${hunterData.score}/100`} accent={hunterData.score > 70 ? "#00ff41" : "#ffaa00"} />
                <InfoRow label="SMTP Valid" value={hunterData.smtpCheck ? "Yes" : "No"} />
                <InfoRow label="MX Records" value={hunterData.mxRecords ? "Found" : "Not found"} />
                <InfoRow label="Disposable" value={hunterData.disposable ? "YES" : "No"} accent={hunterData.disposable ? "#ff3e3e" : "#00ff41"} />
                <InfoRow label="Accept All" value={hunterData.acceptAll ? "Yes (catch-all)" : "No"} />
                <InfoRow label="Blocked" value={hunterData.block ? "YES" : "No"} accent={hunterData.block ? "#ff3e3e" : "#00ff41"} />
                {hunterData.gibberish && <InfoRow label="Gibberish" value="YES — fake-looking" accent="#ffaa00" />}
              </>
            ) : (
              <div className="text-center py-3 text-[#888] text-[13px] font-mono">
                {hunter.error === "NOT_CONFIGURED" ? "Add HUNTER_API_KEY — free 25/month" : hunter.error ?? "No data"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── OSINT pivots ── */}
      <section id="sec-pivots" className="scroll-mt-24"><EmailOsintPivots email={email} domain={analysis.domain} /></section>
      <SourceStrip sources={emailSources} />
    </motion.div>
  );
}
