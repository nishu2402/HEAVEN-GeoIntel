"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";

interface Props {
  e164: string;
  national: string;
}

interface Dork {
  label: string;
  query: string;
  engine?: string; // search engine to use (default Google)
}

export default function DorkGenerator({ e164, national }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(console.error);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const dorks: Dork[] = [
    { label: "Exact E.164", query: `"${e164}"` },
    { label: "National format", query: `"${national}"` },
    { label: "Both formats", query: `"${e164}" OR "${national}"` },
    { label: "PDF documents", query: `"${e164}" filetype:pdf` },
    { label: "Text / log files", query: `"${e164}" filetype:txt OR filetype:log` },
    { label: "LinkedIn", query: `site:linkedin.com "${e164}"` },
    { label: "Facebook", query: `site:facebook.com "${e164}"` },
    { label: "Twitter / X", query: `site:twitter.com "${e164}"` },
    { label: "GitHub code", query: `site:github.com "${e164}"` },
    { label: "Pastebin leak", query: `site:pastebin.com "${e164}"` },
    { label: "Credentials / breach", query: `"${e164}" (password OR email OR credentials OR leak OR breach)` },
    { label: "Forum / community", query: `"${e164}" (forum OR thread OR post OR reply)` },
    { label: "Resume / CV", query: `"${national}" (resume OR CV OR curriculum vitae)` },
    { label: "Contact page", query: `"${e164}" (contact OR reach OR call us OR phone)` },
    { label: "Database dumps", query: `"${e164}" (dump OR database OR db OR sql)` },
    { label: "Social media any", query: `"${e164}" site:instagram.com OR site:tiktok.com OR site:reddit.com` },
    { label: "Email correlation", query: `"${e164}" "@gmail.com" OR "@yahoo.com" OR "@hotmail.com"` },
    { label: "Google Maps biz", query: `"${national}" site:maps.google.com OR site:google.com/maps` },
  ];

  const googleBase = "https://www.google.com/search?q=";

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="text-xs uppercase tracking-widest text-[#00ff41]/50 border-b border-[#00ff41]/15 pb-2">
        [ DORK GENERATOR ] — {dorks.length} queries — click to copy or open
      </div>
      <div className="text-[13px] text-[#00ff41]/55">
        Copy → paste into any search engine. Or click the arrow to open in Google directly.
      </div>

      <div className="divide-y divide-[#00ff41]/[0.06]">
        {dorks.map((d) => {
          const isCopied = copiedKey === d.label;
          return (
            <div
              key={d.label}
              className="flex items-center gap-2 py-1.5 px-1 hover:bg-[#00ff41]/5 transition-colors group"
            >
              <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/35 w-32 shrink-0 leading-tight">
                {d.label}
              </span>
              <span className="font-mono text-[13px] text-[#00ff41]/70 flex-1 min-w-0 truncate" title={d.query}>
                {d.query}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => copy(d.query, d.label)}
                  className="p-1 text-[#00ff41]/55 hover:text-[#00ff41] transition-colors"
                  title="Copy query"
                >
                  {isCopied ? <Check className="w-3 h-3 text-[#00ff41]" /> : <Copy className="w-3 h-3" />}
                </button>
                <a
                  href={`${googleBase}${encodeURIComponent(d.query)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 text-[#00ff41]/45 hover:text-[#00d9ff] transition-colors"
                  title="Open in Google"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
