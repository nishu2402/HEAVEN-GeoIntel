"use client";

import { ExternalLink } from "lucide-react";

interface Props {
  e164: string;
  national: string;
  country?: string;
}

interface PivotLink {
  label: string;
  description: string;
  url: string;
  color: string;
  category: "identity" | "breach" | "social" | "spam" | "carrier";
}

function buildLinks(e164: string, national: string, country: string): PivotLink[] {
  const encoded = encodeURIComponent(e164);
  const encodedNational = encodeURIComponent(national);
  const digits = e164.replace(/\D/g, "");
  const cc = country.toLowerCase();

  return [
    // Identity / reverse lookup
    {
      label: "Truecaller",
      description: "Crowd-sourced caller ID & spam reports",
      url: `https://www.truecaller.com/search/${cc}/${encodedNational}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "Sync.me",
      description: "Global reverse phone lookup",
      url: `https://sync.me/search/?number=${encoded}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "NumLookup",
      description: "Free carrier & CNAM lookup",
      url: `https://www.numlookup.com/?number=${encoded}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "That's Them",
      description: "US people search by phone",
      url: `https://thatsthem.com/phone/${digits}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "Spy Dialer",
      description: "Free reverse phone lookup",
      url: `https://spydialer.com/default.aspx?phone=${digits}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "CallerSmart",
      description: "Caller ID community reports",
      url: `https://www.callersmart.com/phone-number/${digits}`,
      color: "#00d9ff",
      category: "identity",
    },
    // Breach / data exposure
    {
      label: "Epieos",
      description: "Phone → email / social correlation",
      url: `https://epieos.com/?q=${encoded}&t=phone`,
      color: "#ffaa00",
      category: "breach",
    },
    {
      label: "HaveIBeenPwned",
      description: "Breach database & data exposure",
      url: `https://haveibeenpwned.com/`,
      color: "#ffaa00",
      category: "breach",
    },
    // Social / open web
    {
      label: "Google: LinkedIn",
      description: `site:linkedin.com "${e164}"`,
      url: `https://www.google.com/search?q=site:linkedin.com+%22${encoded}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google: Facebook",
      description: `site:facebook.com "${e164}"`,
      url: `https://www.google.com/search?q=site:facebook.com+%22${encoded}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google: Instagram",
      description: `site:instagram.com "${national}"`,
      url: `https://www.google.com/search?q=site:instagram.com+%22${encodedNational}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google Dork",
      description: `Broad open-web search`,
      url: `https://www.google.com/search?q=%22${encoded}%22+OR+%22${encodedNational}%22`,
      color: "#00ff41",
      category: "social",
    },
    // Spam / abuse
    {
      label: "800notes",
      description: "Community spam call reports",
      url: `https://800notes.com/Phone.aspx/${digits}`,
      color: "#ff3e3e",
      category: "spam",
    },
    {
      label: "Should I Answer",
      description: "Spam & scam call ratings",
      url: `https://www.shouldianswer.com/phone-number/${digits}`,
      color: "#ff3e3e",
      category: "spam",
    },
    {
      label: "Who Called Me",
      description: "International spam call database",
      url: `https://www.whocalledme.com/PhoneNumber/${digits}`,
      color: "#ff3e3e",
      category: "spam",
    },
    // Carrier / telecom
    {
      label: "PhoneValidator",
      description: "Line type & carrier validator",
      url: `https://www.phonevalidator.com/index.aspx?phone=${encodedNational}`,
      color: "#888",
      category: "carrier",
    },
  ];
}

const CATEGORY_LABELS: Record<string, string> = {
  identity: "IDENTITY / REVERSE LOOKUP",
  breach: "BREACH / DATA EXPOSURE",
  social: "SOCIAL / OPEN WEB",
  spam: "SPAM / ABUSE REPORTS",
  carrier: "CARRIER / TELECOM",
};

const CATEGORY_ORDER = ["identity", "breach", "social", "spam", "carrier"] as const;

export default function OsintPivots({ e164, national, country = "us" }: Props) {
  const links = buildLinks(e164, national, country);
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: links.filter((l) => l.category === cat),
  }));

  return (
    <div className="terminal-card p-4 space-y-4">
      <div className="text-xs uppercase tracking-widest text-[#00ff41]/50 border-b border-[#00ff41]/15 pb-2">
        [ OSINT PIVOTS ] — {links.length} investigation links
      </div>
      <div className="text-[10px] text-[#00ff41]/30 italic">
        External services open in a new tab. Use only within legal bounds.
      </div>

      {byCategory.map(({ cat, items }) =>
        items.length === 0 ? null : (
          <div key={cat} className="space-y-1.5">
            <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/25 font-mono pb-0.5">
              — {CATEGORY_LABELS[cat]} —
            </div>
            <div className="grid grid-cols-2 gap-2">
              {items.map((link) => (
                <a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 p-2.5 border border-[#00ff41]/15 hover:border-[#00ff41]/40 hover:bg-[#00ff41]/5 transition-all"
                >
                  <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" style={{ color: link.color }} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: link.color }}>
                      {link.label}
                    </div>
                    <div className="text-[9px] text-[#00ff41]/35 mt-0.5 leading-tight">{link.description}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
