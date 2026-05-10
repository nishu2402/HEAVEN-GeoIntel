"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  User, Mail, Globe, Shield, AlertTriangle, CheckCircle2,
  XCircle, Copy, Check, Download, ExternalLink,
  Building2, Lock, Trash2, Hash,
} from "lucide-react";
import type { EmailLookupResponse } from "@/lib/types";
import EmailOsintPivots from "./EmailOsintPivots";
import { cn } from "@/lib/utils";

interface Props {
  data: EmailLookupResponse;
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(console.error);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="flex items-center gap-1 text-xs border border-[#00ff41]/30 px-2 py-1 text-[#00ff41]/60 hover:text-[#00ff41] hover:border-[#00ff41]/60 transition-colors font-mono"
    >
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {done ? "COPIED" : "COPY"}
    </button>
  );
}

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[#00ff41]/[0.06]">
      <span className="text-[9px] uppercase tracking-widest text-[#00ff41]/35 w-36 shrink-0 pt-0.5">{label}</span>
      <span className="font-mono text-xs flex-1 break-all" style={{ color: accent ?? "#00ff41" }}>
        {value}
      </span>
    </div>
  );
}

function Badge({
  text, color = "#00ff41", bg,
}: { text: string; color?: string; bg?: string }) {
  return (
    <span
      className="text-[9px] font-mono font-bold px-2 py-0.5 border tracking-widest"
      style={{ color, borderColor: color + "50", backgroundColor: bg ?? color + "0d" }}
    >
      {text}
    </span>
  );
}

function downloadReport(data: EmailLookupResponse): void {
  const { email, analysis, gravatar, emailrep, hunter, abstract } = data;
  const sep = "─".repeat(70);
  const now = new Date().toISOString();

  const lines = [
    `HEAVEN-GeoIntel — Email Intelligence Report`,
    `Generated  : ${now}`,
    sep,
    ``,
    `TARGET EMAIL`,
    sep,
    `  Address         : ${email}`,
    `  Username        : ${analysis.username}`,
    `  Domain          : ${analysis.domain}`,
    `  TLD             : .${analysis.tld}`,
    `  Valid Format    : ${analysis.isValidFormat ? "Yes" : "No"}`,
    ``,
    `OFFLINE CLASSIFICATION`,
    sep,
    `  Provider Type   : ${analysis.providerType}`,
    `  Provider Name   : ${analysis.providerName}`,
    `  Disposable      : ${analysis.isDisposable ? "YES — THROWAWAY" : "No"}`,
    `  Privacy Focused : ${analysis.isPrivacyFocused ? "YES — encrypted/anonymous provider" : "No"}`,
    `  Webmail         : ${analysis.isWebmail ? "Yes" : "No"}`,
    `  Role Address    : ${analysis.isRoleAddress ? "YES (generic role address)" : "No"}`,
    `  Guessed Name    : ${analysis.guessedName ?? "N/A"}`,
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
      `  Avatar URL      : ${gravatar.thumbnailUrl ?? "N/A"}`,
      `  Linked Accounts : ${gravatar.accounts.map(a => `${a.shortname}:${a.username}`).join(", ") || "None"}`,
    ] : []),
    ``,
    `REPUTATION INTEL (EmailRep.io)`,
    sep,
    ...(emailrep.ok && emailrep.data ? [
      `  Reputation      : ${emailrep.data.reputation.toUpperCase()}`,
      `  Suspicious      : ${emailrep.data.suspicious ? "YES" : "No"}`,
      `  References      : ${emailrep.data.references}`,
      `  Credentials Leaked : ${emailrep.data.credentialsLeaked ? "YES — CRITICAL" : "No"}`,
      `  Data Breach     : ${emailrep.data.dataBreach ? "YES" : "No"}`,
      `  Malicious Activity : ${emailrep.data.maliciousActivity ? "YES" : "No"}`,
      `  Spam            : ${emailrep.data.spam ? "YES" : "No"}`,
      `  Deliverable     : ${emailrep.data.deliverable ? "Yes" : "No"}`,
      `  Valid MX        : ${emailrep.data.validMx ? "Yes" : "No"}`,
      `  Primary MX      : ${emailrep.data.primaryMx ?? "N/A"}`,
      `  First Seen      : ${emailrep.data.firstSeen ?? "N/A"}`,
      `  Last Seen       : ${emailrep.data.lastSeen ?? "N/A"}`,
      `  Profiles        : ${emailrep.data.profiles.join(", ") || "None"}`,
    ] : [`  Status          : ${emailrep.ok ? "No data" : (emailrep.error ?? "Error")}`]),
    ``,
    `EMAIL VALIDATION (Abstract API)`,
    sep,
    ...(abstract.ok && abstract.data ? [
      `  Deliverability  : ${abstract.data.deliverability}`,
      `  Quality Score   : ${abstract.data.qualityScore}/1.0`,
      `  SMTP Valid      : ${abstract.data.isSmtpValid ? "Yes" : "No"}`,
      `  MX Found        : ${abstract.data.isMxFound ? "Yes" : "No"}`,
      `  Disposable      : ${abstract.data.isDisposableEmail ? "YES" : "No"}`,
      `  Role Address    : ${abstract.data.isRoleEmail ? "YES" : "No"}`,
      `  Catch-All       : ${abstract.data.isCatchallEmail ? "Yes" : "No"}`,
      `  Autocorrect     : ${abstract.data.autocorrect || "None"}`,
    ] : [`  Status          : ${abstract.error === "NOT_CONFIGURED" ? "NOT CONFIGURED (add ABSTRACT_API_KEY)" : (abstract.error ?? "Error")}`]),
    ``,
    `DELIVERABILITY (Hunter.io)`,
    sep,
    ...(hunter.ok && hunter.data ? [
      `  Result          : ${hunter.data.result.toUpperCase()}`,
      `  Confidence      : ${hunter.data.score}/100`,
      `  Disposable      : ${hunter.data.disposable ? "YES" : "No"}`,
      `  Webmail         : ${hunter.data.webmail ? "Yes" : "No"}`,
      `  SMTP Check      : ${hunter.data.smtpCheck ? "Passed" : "Failed"}`,
      `  MX Records      : ${hunter.data.mxRecords ? "Found" : "Not found"}`,
      `  Accept All      : ${hunter.data.acceptAll ? "Yes" : "No"}`,
      `  Blocked         : ${hunter.data.block ? "YES" : "No"}`,
    ] : [`  Status          : ${hunter.error === "NOT_CONFIGURED" ? "NOT CONFIGURED (add HUNTER_API_KEY)" : (hunter.error ?? "Error")}`]),
    ``,
    sep,
    `Report generated by HEAVEN-GeoIntel — for authorized use only.`,
  ];

  const content = lines.join("\n");
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `email_intel_${email.replace("@", "_at_")}_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

const PROVIDER_COLORS: Record<string, string> = {
  free: "#00d9ff",
  corporate: "#00ff41",
  educational: "#00d9ff",
  government: "#ffaa00",
  privacy: "#888",
  disposable: "#ff3e3e",
  unknown: "#555",
};

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  free: <Mail className="w-3 h-3" />,
  corporate: <Building2 className="w-3 h-3" />,
  educational: <Globe className="w-3 h-3" />,
  government: <Shield className="w-3 h-3" />,
  privacy: <Lock className="w-3 h-3" />,
  disposable: <Trash2 className="w-3 h-3" />,
};

export default function EmailResultsDashboard({ data }: Props) {
  const { email, analysis, gravatar, emailrep, hunter, abstract } = data;

  const repData = emailrep.ok ? emailrep.data : null;
  const hunterData = hunter.ok ? hunter.data : null;
  const abstractData = abstract.ok ? abstract.data : null;

  const provColor = PROVIDER_COLORS[analysis.providerType] ?? "#00ff41";

  // Determine confirmed name (priority: Gravatar > guessedName)
  const confirmedName = gravatar.found ? (gravatar.displayName ?? gravatar.preferredUsername) : null;
  const nameToShow = confirmedName ?? analysis.guessedName;
  const nameSource = confirmedName ? "gravatar" : analysis.guessedName ? "inferred" : null;

  // Registered platforms from emailrep
  const platforms = repData?.profiles ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-4 mt-6"
    >
      {/* ── Header ── */}
      <div className="terminal-card p-5 space-y-4">
        <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40">EMAIL INTELLIGENCE RESULT</div>

        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="space-y-2">
            {/* Avatar + name */}
            <div className="flex items-center gap-4">
              {gravatar.found && gravatar.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={gravatar.thumbnailUrl}
                  alt="Gravatar"
                  className="w-14 h-14 rounded-none border border-[#00ff41]/30"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <div>
                {nameToShow && (
                  <div className="flex items-center gap-2 mb-1">
                    <User className="w-4 h-4 text-[#00d9ff]" />
                    <span className="text-xl font-bold text-[#00d9ff] font-mono">{nameToShow}</span>
                    <span className={cn(
                      "text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border",
                      nameSource === "gravatar"
                        ? "text-[#00ff41] border-[#00ff41]/30 bg-[#00ff41]/5"
                        : "text-[#888] border-[#888]/30"
                    )}>
                      {nameSource === "gravatar" ? "✓ GRAVATAR CONFIRMED" : "INFERRED"}
                    </span>
                  </div>
                )}
                <div className="text-xl font-bold glow-green tracking-wider font-mono">{email}</div>
                <div className="text-sm text-[#00ff41]/60 mt-0.5 font-mono">
                  {analysis.username} @ {analysis.domain}
                </div>
                {gravatar.found && gravatar.currentLocation && (
                  <div className="text-xs text-[#00d9ff]/70 mt-1 font-mono">📍 {gravatar.currentLocation}</div>
                )}
                {gravatar.found && gravatar.aboutMe && (
                  <div className="text-xs text-[#00ff41]/50 mt-1 font-mono italic max-w-md line-clamp-2">
                    &ldquo;{gravatar.aboutMe}&rdquo;
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2 items-start">
            <Badge text={analysis.providerType.toUpperCase()} color={provColor} />
            {analysis.isDisposable && <Badge text="DISPOSABLE" color="#ff3e3e" />}
            {analysis.isPrivacyFocused && <Badge text="PRIVACY PROVIDER" color="#888" />}
            {analysis.isRoleAddress && <Badge text="ROLE ADDRESS" color="#ffaa00" />}
            {repData?.suspicious && <Badge text="SUSPICIOUS" color="#ff3e3e" />}
            {repData?.credentialsLeaked && <Badge text="CREDENTIALS LEAKED" color="#ff3e3e" />}
            {repData?.dataBreach && <Badge text="IN DATA BREACH" color="#ff3e3e" />}
            {gravatar.found && <Badge text="GRAVATAR FOUND" color="#00ff41" />}
            {data.cachedAt && <Badge text="CACHED" color="#444" />}
          </div>
        </div>

        {/* Action row */}
        <div className="flex gap-2 flex-wrap pt-1 border-t border-[#00ff41]/10">
          <CopyBtn text={email} />
          <CopyBtn text={analysis.domain} />
          {gravatar.found && gravatar.profileUrl && (
            <a
              href={gravatar.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs border border-[#00d9ff]/30 px-2 py-1 text-[#00d9ff]/60 hover:text-[#00d9ff] hover:border-[#00d9ff]/60 transition-colors font-mono"
            >
              <ExternalLink className="w-3 h-3" /> GRAVATAR PROFILE
            </a>
          )}
          <button
            onClick={() => downloadReport(data)}
            className="flex items-center gap-1 text-xs border border-[#00d9ff]/30 px-2 py-1 text-[#00d9ff]/60 hover:text-[#00d9ff] hover:border-[#00d9ff]/60 transition-colors font-mono"
          >
            <Download className="w-3 h-3" /> EXPORT REPORT
          </button>
        </div>
      </div>

      {/* ── Two-column: Offline analysis + Gravatar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Offline analysis */}
        <div className="terminal-card p-4 space-y-1">
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/40 mb-3 flex items-center gap-1.5">
            {PROVIDER_ICONS[analysis.providerType]}
            OFFLINE CLASSIFICATION — no API required
          </div>
          <InfoRow label="Provider" value={analysis.providerName} accent={provColor} />
          <InfoRow label="Provider Type" value={analysis.providerType.toUpperCase()} accent={provColor} />
          <InfoRow label="Domain" value={analysis.domain} />
          <InfoRow label="TLD" value={`.${analysis.tld}`} />
          <InfoRow label="Username" value={analysis.username} />
          <InfoRow label="Disposable" value={analysis.isDisposable ? "YES — THROWAWAY ACCOUNT" : "No"} accent={analysis.isDisposable ? "#ff3e3e" : "#00ff41"} />
          <InfoRow label="Privacy Provider" value={analysis.isPrivacyFocused ? "YES — Encrypted / Anonymous" : "No"} accent={analysis.isPrivacyFocused ? "#888" : "#00ff41"} />
          <InfoRow label="Webmail" value={analysis.isWebmail ? "Yes — free personal mail" : "No"} />
          <InfoRow label="Role Address" value={analysis.isRoleAddress ? "YES — generic inbox" : "No"} accent={analysis.isRoleAddress ? "#ffaa00" : "#00ff41"} />
          {analysis.guessedName && (
            <InfoRow label="Inferred Name" value={`${analysis.guessedName} (from username pattern)`} accent="#00d9ff" />
          )}
        </div>

        {/* Gravatar profile */}
        <div className="terminal-card p-4 space-y-1">
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/40 mb-3 flex items-center gap-1.5">
            <User className="w-3 h-3" />
            GRAVATAR PROFILE — free, no API key
          </div>
          {gravatar.found ? (
            <>
              <InfoRow label="Status" value="FOUND — profile exists" accent="#00ff41" />
              <InfoRow label="Display Name" value={gravatar.displayName ?? "N/A"} accent="#00d9ff" />
              <InfoRow label="Username" value={gravatar.preferredUsername ?? "N/A"} accent="#00d9ff" />
              <InfoRow label="Location" value={gravatar.currentLocation ?? "N/A"} />
              <InfoRow label="About" value={gravatar.aboutMe ?? "N/A"} />
              {gravatar.profileUrl && (
                <InfoRow label="Profile URL" value={gravatar.profileUrl} />
              )}
              {gravatar.accounts.length > 0 && (
                <div className="pt-2">
                  <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/35 mb-1.5">LINKED ACCOUNTS</div>
                  <div className="flex flex-wrap gap-1.5">
                    {gravatar.accounts.map((acc) => (
                      <a
                        key={acc.shortname + acc.username}
                        href={acc.url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] font-mono border border-[#00d9ff]/30 bg-[#00d9ff]/5 text-[#00d9ff] px-2 py-0.5 hover:border-[#00d9ff]/60 transition-colors"
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
            <div className="text-center py-6 text-[#00ff41]/25 font-mono text-xs">
              No Gravatar profile found for this email.
            </div>
          )}
        </div>
      </div>

      {/* ── Reputation + Validation ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* EmailRep.io */}
        <div className="terminal-card p-4 space-y-1">
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/40 mb-3 flex items-center gap-1.5">
            <Shield className="w-3 h-3" />
            REPUTATION — EmailRep.io
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
              <InfoRow label="Credentials Leaked" value={repData.credentialsLeaked ? "YES — CREDENTIALS IN BREACH DB" : "No"} accent={repData.credentialsLeaked ? "#ff3e3e" : "#00ff41"} />
              <InfoRow label="Data Breach" value={repData.dataBreach ? "YES" : "No"} accent={repData.dataBreach ? "#ff3e3e" : "#00ff41"} />
              <InfoRow label="Malicious Activity" value={repData.maliciousActivity ? "YES" : "No"} accent={repData.maliciousActivity ? "#ff3e3e" : "#00ff41"} />
              <InfoRow label="Spam" value={repData.spam ? "YES" : "No"} accent={repData.spam ? "#ff3e3e" : "#00ff41"} />
              <InfoRow label="Deliverable" value={repData.deliverable ? "Yes" : "No"} accent={repData.deliverable ? "#00ff41" : "#ff3e3e"} />
              <InfoRow label="Valid MX" value={repData.validMx ? "Yes" : "No"} />
              <InfoRow label="Primary MX" value={repData.primaryMx ?? "N/A"} />
              <InfoRow label="First Seen" value={repData.firstSeen ?? "N/A"} />
              <InfoRow label="Last Seen" value={repData.lastSeen ?? "N/A"} />
              {platforms.length > 0 && (
                <div className="pt-2">
                  <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/35 mb-1.5">REGISTERED PLATFORMS</div>
                  <div className="flex flex-wrap gap-1.5">
                    {platforms.map((p) => (
                      <span key={p} className="text-[10px] font-mono border border-[#00ff41]/30 bg-[#00ff41]/5 text-[#00ff41] px-2 py-0.5">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6">
              <div className="text-[#555] text-xs font-mono">
                {emailrep.error === "RATE_LIMITED"
                  ? "Rate limited — try again in a moment"
                  : "EmailRep.io did not return data"}
              </div>
            </div>
          )}
        </div>

        {/* Abstract + Hunter combined */}
        <div className="space-y-4">
          {/* Abstract API */}
          <div className="terminal-card p-4 space-y-1">
            <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/40 mb-3 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" />
              EMAIL VALIDATION — Abstract API
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
                <InfoRow label="Role Email" value={abstractData.isRoleEmail ? "YES" : "No"} accent={abstractData.isRoleEmail ? "#ffaa00" : "#00ff41"} />
                <InfoRow label="Catch-All" value={abstractData.isCatchallEmail ? "Yes" : "No"} />
                {abstractData.autocorrect && (
                  <InfoRow label="Did You Mean" value={abstractData.autocorrect} accent="#ffaa00" />
                )}
              </>
            ) : (
              <div className="text-center py-3 text-[#555] text-[10px] font-mono">
                {abstract.error === "NOT_CONFIGURED" ? "Add ABSTRACT_API_KEY — free 250/month" : abstract.error ?? "No data"}
              </div>
            )}
          </div>

          {/* Hunter.io */}
          <div className="terminal-card p-4 space-y-1">
            <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/40 mb-3 flex items-center gap-1.5">
              <Hash className="w-3 h-3" />
              DELIVERABILITY — Hunter.io
            </div>
            {hunterData ? (
              <>
                <InfoRow
                  label="Result"
                  value={hunterData.result.toUpperCase()}
                  accent={hunterData.result === "deliverable" ? "#00ff41" : hunterData.result === "risky" ? "#ffaa00" : "#ff3e3e"}
                />
                <InfoRow label="Confidence" value={`${hunterData.score}/100`} accent={hunterData.score > 70 ? "#00ff41" : "#ffaa00"} />
                <InfoRow label="Disposable" value={hunterData.disposable ? "YES" : "No"} accent={hunterData.disposable ? "#ff3e3e" : "#00ff41"} />
                <InfoRow label="Webmail" value={hunterData.webmail ? "Yes" : "No"} />
                <InfoRow label="MX Records" value={hunterData.mxRecords ? "Found" : "Not found"} />
                <InfoRow label="SMTP Valid" value={hunterData.smtpCheck ? "Yes" : "No"} />
                <InfoRow label="Accept All" value={hunterData.acceptAll ? "Yes (catch-all)" : "No"} />
                <InfoRow label="Blocked" value={hunterData.block ? "YES — blocked by server" : "No"} accent={hunterData.block ? "#ff3e3e" : "#00ff41"} />
                {hunterData.gibberish && <InfoRow label="Gibberish" value="YES — fake-looking address" accent="#ffaa00" />}
              </>
            ) : (
              <div className="text-center py-3 text-[#555] text-[10px] font-mono">
                {hunter.error === "NOT_CONFIGURED" ? "Add HUNTER_API_KEY — free 25/month" : hunter.error ?? "No data"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Risk summary ── */}
      {repData && (repData.credentialsLeaked || repData.dataBreach || repData.suspicious || repData.maliciousActivity) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="terminal-card p-4 border border-[#ff3e3e]/30 bg-[#ff3e3e]/[0.03]"
        >
          <div className="text-[9px] uppercase tracking-widest text-[#ff3e3e]/70 mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> RISK INDICATORS DETECTED
          </div>
          <div className="grid grid-cols-2 gap-2">
            {repData.credentialsLeaked && (
              <div className="flex items-start gap-2 text-[10px] font-mono text-[#ff3e3e]">
                <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                Credentials found in breach databases — passwords may be known
              </div>
            )}
            {repData.dataBreach && (
              <div className="flex items-start gap-2 text-[10px] font-mono text-[#ff3e3e]">
                <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                Email appeared in one or more data breaches
              </div>
            )}
            {repData.suspicious && (
              <div className="flex items-start gap-2 text-[10px] font-mono text-[#ffaa00]">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                Flagged as suspicious by reputation engine
              </div>
            )}
            {repData.maliciousActivity && (
              <div className="flex items-start gap-2 text-[10px] font-mono text-[#ff3e3e]">
                <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                Associated with malicious activity (phishing, spam, fraud)
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── OSINT pivots ── */}
      <EmailOsintPivots email={email} domain={analysis.domain} username={analysis.username} />
    </motion.div>
  );
}
