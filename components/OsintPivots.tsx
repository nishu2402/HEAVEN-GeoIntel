"use client";

import { ExternalLink } from "lucide-react";

interface Props {
  e164: string;
  national: string;
}

interface PivotLink {
  label: string;
  description: string;
  url: string;
  color: string;
}

function buildLinks(e164: string, national: string): PivotLink[] {
  const encoded = encodeURIComponent(e164);
  const encodedNational = encodeURIComponent(national);

  return [
    {
      label: "Truecaller",
      description: "Crowd-sourced caller ID",
      url: `https://www.truecaller.com/search/us/${encodedNational}`,
      color: "#00d9ff",
    },
    {
      label: "Sync.me",
      description: "Reverse phone lookup",
      url: `https://sync.me/search/?number=${encoded}`,
      color: "#00d9ff",
    },
    {
      label: "Epieos",
      description: "Phone → email / social correlation",
      url: `https://epieos.com/?q=${encoded}&t=phone`,
      color: "#00d9ff",
    },
    {
      label: "HaveIBeenPwned",
      description: "Breach database search",
      url: `https://haveibeenpwned.com/`,
      color: "#ffaa00",
    },
    {
      label: "Google: LinkedIn",
      description: `site:linkedin.com "${e164}"`,
      url: `https://www.google.com/search?q=site:linkedin.com+"${encoded}"`,
      color: "#00ff41",
    },
    {
      label: "Google: Facebook",
      description: `site:facebook.com "${e164}"`,
      url: `https://www.google.com/search?q=site:facebook.com+"${encoded}"`,
      color: "#00ff41",
    },
    {
      label: "Google Dork",
      description: `Broad open-web search for "${e164}"`,
      url: `https://www.google.com/search?q="${encoded}"`,
      color: "#00ff41",
    },
    {
      label: "NumLookup",
      description: "Free phone number lookup",
      url: `https://www.numlookup.com/?number=${encoded}`,
      color: "#00d9ff",
    },
  ];
}

export default function OsintPivots({ e164, national }: Props) {
  const links = buildLinks(e164, national);

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="text-xs uppercase tracking-widest text-[#00ff41]/50 border-b border-[#00ff41]/15 pb-2">
        [ OSINT PIVOTS ] — Manual investigation links
      </div>
      <div className="text-[10px] text-[#00ff41]/30 italic">
        These links open external services in a new tab. Use responsibly and within legal bounds.
      </div>
      <div className="grid grid-cols-2 gap-2">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 p-2.5 border border-[#00ff41]/15 hover:border-[#00ff41]/40 hover:bg-[#00ff41]/5 transition-all group"
          >
            <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" style={{ color: link.color }} />
            <div>
              <div className="text-xs font-bold" style={{ color: link.color }}>
                {link.label}
              </div>
              <div className="text-[10px] text-[#00ff41]/40 mt-0.5">{link.description}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
