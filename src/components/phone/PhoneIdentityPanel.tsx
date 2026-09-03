"use client";

import { motion } from "framer-motion";
import {
  User, Briefcase, ExternalLink, Mail, Phone, Building2, AtSign, Search,
} from "lucide-react";
import type { LookupResponse, FullContactData } from "@/lib/types";
import { safeExternalUrl } from "@/lib/utils";
import { isPlausibleUsername } from "@/lib/data/usernameSites";

interface Props {
  data: LookupResponse;
  /** Cross-tool pivots on FullContact-discovered identities (in-app lookups). */
  onUsernameSweep?: (handle: string) => void;
  onEmailLookup?: (email: string) => void;
}

function Badge({ text, color = "#00ff41" }: { text: string; color?: string }) {
  return (
    <span
      className="text-[12px] font-mono font-bold px-2 py-0.5 border tracking-widest"
      style={{ color, borderColor: color + "70", backgroundColor: color + "18" }}
    >
      {text}
    </span>
  );
}

export default function PhoneIdentityPanel({ data, onUsernameSweep, onEmailLookup }: Props) {
  const fc: FullContactData | undefined = data.sources.fullContact.ok
    ? data.sources.fullContact.data
    : undefined;
  const cnamName  = data.aggregated.callerName;
  const cnamType  = data.aggregated.callerType;

  // Build a single, prioritized identity surface.
  // Priority: FullContact (real enrichment) > CNAM (carrier database)
  const realName    = fc?.fullName ?? cnamName ?? null;
  const realLocation = fc?.location ?? data.aggregated.city ?? data.aggregated.region ?? null;
  const realTitle    = fc?.title ?? null;
  const realOrg      = fc?.organization ?? null;
  const realBio      = fc?.bio ?? null;
  const avatar       = fc?.avatar ?? null;
  const profiles     = fc?.profiles ?? [];
  const otherEmails  = fc?.otherEmails ?? [];
  const otherPhones  = fc?.phones ?? [];
  const employment   = fc?.employment ?? [];
  const ipqsEmails   = data.aggregated.associatedEmails ?? [];

  const fcConfigured = data.sources.fullContact.error !== "NOT_CONFIGURED";
  const hasAnyIdentity =
    realName || realLocation || realTitle || realOrg || realBio || avatar ||
    profiles.length > 0 || otherEmails.length > 0 || otherPhones.length > 0 ||
    employment.length > 0 || ipqsEmails.length > 0;

  if (!hasAnyIdentity) {
    // No identity data was resolved — present an action center instead of an
    // empty wall.  Each link is a free, no-login lookup that genuinely accepts
    // the phone number in the URL and returns owner information.
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="terminal-card p-4 space-y-3 border border-[#00d9ff]/20"
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[12px] uppercase tracking-widest text-[#00d9ff]/65 flex items-center gap-1.5">
            <User className="w-3 h-3" /> IDENTITY: OWNER PROFILE
          </div>
          <span className="text-[11px] font-mono text-[#00ff41]/54">No automatic enrichment: try free lookups below</span>
        </div>

        <p className="text-[13px] font-mono text-[#00ff41]/60 leading-snug">
          No identity resolved through configured APIs. Scroll down to the{" "}
          <span className="text-[#00d9ff]/85 font-bold">OSINT PIVOT MATRIX</span>: a
          single, deduplicated set of reverse-lookup, breach, spam and search links
          that take this number directly (no repeated or dead links).
        </p>

        {!fcConfigured && (
          <p className="text-[11px] font-mono text-[#00ff41]/54 border-t border-[#00ff41]/10 pt-2">
            Want in-app enrichment? Add <code className="text-[#00ff41]/65">FULLCONTACT_API_KEY</code>{" "}
            to <code className="text-[#00ff41]/65">.env.local</code> for inline name/employer/social-profile data.
          </p>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="terminal-card p-5 space-y-4 border-l-2 border-[#00d9ff]/40"
    >
      <div className="flex items-center justify-between">
        <div className="text-[12px] uppercase tracking-widest text-[#00d9ff]/60 flex items-center gap-1.5">
          <User className="w-3 h-3" /> IDENTITY: owner profile
        </div>
        <div className="flex gap-1.5">
          {fc && <Badge text="FULLCONTACT ✓" color="#00d9ff" />}
          {cnamName && !fc?.fullName && <Badge text="CNAM ✓" color="#00ff41" />}
        </div>
      </div>

      {/* Top row: avatar + name + headline */}
      <div className="flex items-start gap-4">
        {avatar && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt="Profile"
            className="w-16 h-16 border border-[#00d9ff]/30 shrink-0 object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          {realName && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl font-bold text-[#00d9ff] font-mono">{realName}</span>
              {cnamType && (
                <Badge text={cnamType.toUpperCase()} color="#00d9ff" />
              )}
            </div>
          )}
          {(realTitle || realOrg) && (
            <div className="flex items-center gap-1.5 text-[13px] text-[#00ff41]/75 font-mono">
              <Briefcase className="w-3 h-3 shrink-0" />
              {realTitle && realOrg
                ? `${realTitle} @ ${realOrg}`
                : (realTitle ?? realOrg)}
            </div>
          )}
          {realLocation && (
            <div className="text-[13px] text-[#00d9ff]/70 font-mono">
              📍 {realLocation}
            </div>
          )}
          {realBio && (
            <div className="text-[12px] text-[#00ff41]/65 font-mono italic max-w-md line-clamp-2">
              &ldquo;{realBio}&rdquo;
            </div>
          )}
          {(fc?.age != null || fc?.gender) && (
            <div className="flex gap-1.5 pt-0.5">
              {fc?.age != null && <Badge text={`AGE ~${fc.age}`} color="#888" />}
              {fc?.gender && <Badge text={fc.gender.toUpperCase()} color="#888" />}
            </div>
          )}
        </div>
      </div>

      {/* Social profiles */}
      {profiles.length > 0 && (
        <div className="border-t border-[#00ff41]/10 pt-3">
          <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/54 mb-2">
            SOCIAL PROFILES: {profiles.length} linked account{profiles.length === 1 ? "" : "s"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profiles.map((p) => (
              <span key={p.platform + p.username} className="inline-flex items-stretch">
                <a
                  href={safeExternalUrl(p.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[13px] font-mono border border-[#00d9ff]/30 bg-[#00d9ff]/5 text-[#00d9ff] px-2 py-0.5 hover:border-[#00d9ff]/60 hover:bg-[#00d9ff]/10 transition-colors"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  {p.platform}{p.username ? `: ${p.username}` : ""}
                </a>
                {onUsernameSweep && p.username && isPlausibleUsername(p.username) && (
                  <button
                    type="button"
                    onClick={() => onUsernameSweep(p.username)}
                    title={`Sweep "${p.username}" across sites`}
                    aria-label={`Sweep ${p.username} as username`}
                    className="flex items-center border border-l-0 border-[#e879f9]/40 bg-[#e879f9]/5 text-[#e879f9] px-1.5 hover:bg-[#e879f9]/15 transition-colors"
                  >
                    <AtSign className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Linked emails — merge FullContact + IPQS associated emails, dedup */}
      {(otherEmails.length > 0 || ipqsEmails.length > 0) && (
        <div className="border-t border-[#00ff41]/10 pt-3">
          <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/54 mb-1.5 flex items-center gap-1">
            <Mail className="w-2.5 h-2.5" /> LINKED EMAIL ADDRESSES
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(new Set([...otherEmails, ...ipqsEmails])).map((e) => (
              <span key={e} className="inline-flex items-stretch">
                <span className="text-[13px] font-mono border border-[#ffaa00]/30 bg-[#ffaa00]/5 text-[#ffaa00] px-2 py-0.5">
                  {e}
                </span>
                {onEmailLookup && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && (
                  <button
                    type="button"
                    onClick={() => onEmailLookup(e)}
                    title={`Look up "${e}"`}
                    aria-label={`Look up ${e}`}
                    className="flex items-center border border-l-0 border-[#22d3ee]/40 bg-[#22d3ee]/5 text-[#22d3ee] px-1.5 hover:bg-[#22d3ee]/15 transition-colors"
                  >
                    <Search className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Linked phones */}
      {otherPhones.length > 0 && (
        <div className="border-t border-[#00ff41]/10 pt-3">
          <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/54 mb-1.5 flex items-center gap-1">
            <Phone className="w-2.5 h-2.5" /> ALSO REGISTERED TO
          </div>
          <div className="flex flex-wrap gap-1.5">
            {otherPhones.map((p, i) => (
              <span key={`${p}-${i}`}
                className="text-[13px] font-mono border border-[#00d9ff]/30 bg-[#00d9ff]/5 text-[#00d9ff] px-2 py-0.5">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Employment */}
      {employment.length > 0 && (
        <div className="border-t border-[#00ff41]/10 pt-3">
          <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/54 mb-2 flex items-center gap-1">
            <Building2 className="w-2.5 h-2.5" /> EMPLOYMENT HISTORY
          </div>
          <div className="space-y-1">
            {employment.slice(0, 5).map((emp, i) => (
              <div key={`${emp.name}-${i}`} className="flex items-start gap-2 text-xs font-mono">
                <span className={emp.current ? "text-[#00ff41]" : "text-[#888]"}>
                  {emp.current ? "▶" : "·"}
                </span>
                <span className={emp.current ? "text-[#00ff41]/85" : "text-[#888]"}>
                  {emp.name}{emp.title ? `: ${emp.title}` : ""}
                  {emp.current && <span className="ml-2"><Badge text="CURRENT" color="#00ff41" /></span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
