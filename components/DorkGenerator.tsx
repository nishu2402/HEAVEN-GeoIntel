"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";

interface Props {
  e164: string;
  national: string;
}

interface Dork {
  label: string;
  query: string;
}

export default function DorkGenerator({ e164, national }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(console.error);
    setCopiedKey(key);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedKey(null), 1500);
  };

  const dorks = useMemo<Dork[]>(() => [
    // ── Basic format hits ─────────────────────────────────────────────────────
    { label: "Exact E.164",       query: `"${e164}"` },
    { label: "National format",   query: `"${national}"` },
    { label: "Both formats",      query: `"${e164}" OR "${national}"` },
    { label: "Digits only",       query: `"${e164.replace(/\D/g, "")}"` },
    { label: "Spaced digits",     query: `"${e164.replace(/\D/g, "").split("").join(" ")}"` },
    { label: "Dashed format",     query: `"${national.replace(/\s/g, "-")}"` },

    // ── Document / file type leaks ────────────────────────────────────────────
    { label: "PDF documents",     query: `"${e164}" filetype:pdf` },
    { label: "Text / log files",  query: `"${e164}" filetype:txt OR filetype:log` },
    { label: "Excel / CSV",       query: `"${e164}" filetype:xls OR filetype:xlsx OR filetype:csv` },
    { label: "Word / docx",       query: `"${e164}" filetype:doc OR filetype:docx` },
    { label: "SQL dump",          query: `"${e164}" filetype:sql` },
    { label: "JSON / XML data",   query: `"${e164}" filetype:json OR filetype:xml` },
    { label: ".env / config leak",query: `"${e164}" filetype:env OR filetype:cfg OR filetype:conf` },

    // ── Social platforms ──────────────────────────────────────────────────────
    { label: "LinkedIn",          query: `site:linkedin.com "${e164}"` },
    { label: "Facebook",          query: `site:facebook.com "${e164}"` },
    { label: "Twitter / X",       query: `site:twitter.com "${e164}"` },
    { label: "Instagram",         query: `site:instagram.com "${national}"` },
    { label: "TikTok",            query: `site:tiktok.com "${national}"` },
    { label: "YouTube",           query: `site:youtube.com "${national}"` },
    { label: "Reddit",            query: `site:reddit.com "${e164}" OR "${national}"` },
    { label: "Pinterest",         query: `site:pinterest.com "${national}"` },
    { label: "Snapchat",          query: `site:snapchat.com "${national}"` },

    // ── Code / paste / leak sites ─────────────────────────────────────────────
    { label: "GitHub code",       query: `site:github.com "${e164}"` },
    { label: "GitLab code",       query: `site:gitlab.com "${e164}"` },
    { label: "Pastebin leak",     query: `site:pastebin.com "${e164}"` },
    { label: "Paste sites",       query: `site:paste.org OR site:hastebin.com OR site:ghostbin.com "${e164}"` },
    { label: "GitHub Gist",       query: `site:gist.github.com "${e164}"` },
    { label: "S3 bucket leak",    query: `"${e164}" site:s3.amazonaws.com OR site:storage.googleapis.com` },
    { label: "StackOverflow",     query: `site:stackoverflow.com "${national}"` },

    // ── Credentials / breach ──────────────────────────────────────────────────
    { label: "Credentials / breach", query: `"${e164}" (password OR email OR credentials OR leak OR breach)` },
    { label: "Database dumps",    query: `"${e164}" (dump OR database OR db OR sql)` },
    { label: "Password leak",     query: `"${e164}" (password OR passwd OR pwd OR hash OR md5 OR sha1)` },
    { label: "API key leak",      query: `"${e164}" (api_key OR apikey OR secret OR token OR bearer)` },
    { label: "Credential combo",  query: `"${e164}" (":" OR ";" OR "|") (gmail OR yahoo OR hotmail OR outlook)` },

    // ── Messaging / chat groups ───────────────────────────────────────────────
    { label: "WhatsApp group",    query: `"${e164}" site:chat.whatsapp.com` },
    { label: "Telegram group",    query: `"${e164}" site:t.me` },
    { label: "Discord server",    query: `"${e164}" site:discord.gg OR site:discord.com` },
    { label: "Slack workspace",   query: `"${e164}" site:slack.com` },

    // ── Forums / communities ──────────────────────────────────────────────────
    { label: "Forum / community", query: `"${e164}" (forum OR thread OR post OR reply)` },
    { label: "Quora answers",     query: `site:quora.com "${national}"` },
    { label: "Craigslist ad",     query: `site:craigslist.org "${national}"` },
    { label: "WordPress site",    query: `"${national}" inurl:wp-content OR inurl:wordpress` },

    // ── Business / professional ───────────────────────────────────────────────
    { label: "Contact page",      query: `"${e164}" (contact OR reach OR "call us" OR phone)` },
    { label: "Resume / CV",       query: `"${national}" (resume OR CV OR "curriculum vitae")` },
    { label: "Business listing",  query: `"${national}" (company OR business OR LLC OR Inc OR Ltd)` },
    { label: "Yelp listing",      query: `site:yelp.com "${national}"` },
    { label: "BBB listing",       query: `site:bbb.org "${national}"` },
    { label: "Yellow Pages",      query: `site:yellowpages.com "${national}"` },
    { label: "Google Maps biz",   query: `"${national}" site:maps.google.com OR site:google.com/maps` },
    { label: "Trustpilot review", query: `site:trustpilot.com "${national}"` },

    // ── Public records / legal ────────────────────────────────────────────────
    { label: "Court records",     query: `"${national}" (court OR case OR lawsuit OR plaintiff OR defendant)` },
    { label: "Public records",    query: `"${national}" (public record OR government OR .gov)` },
    { label: "WHOIS / domain",    query: `"${national}" site:whois.com OR site:who.is OR site:domaintools.com` },
    { label: "SEC filing",        query: `"${national}" site:sec.gov OR site:edgar.sec.gov` },

    // ── Geo / location ────────────────────────────────────────────────────────
    { label: "Real estate",       query: `"${national}" (realtor OR zillow OR redfin OR property OR listing)` },
    { label: "Hotel / travel",    query: `"${national}" (hotel OR booking OR airbnb OR reservation)` },
    { label: "Meetup / events",   query: `"${national}" site:meetup.com OR site:eventbrite.com` },

    // ── Email correlation ─────────────────────────────────────────────────────
    { label: "Email correlation", query: `"${e164}" "@gmail.com" OR "@yahoo.com" OR "@hotmail.com"` },
    { label: "Corporate email",   query: `"${national}" "@" (company OR corp OR inc OR llc OR org OR edu OR gov)` },

    // ── Misc / broad ──────────────────────────────────────────────────────────
    { label: "Social media any",  query: `"${e164}" site:instagram.com OR site:tiktok.com OR site:reddit.com` },
    { label: "News mention",      query: `"${e164}" (news OR press OR article OR report OR journalist)` },
    { label: "Dark web index",    query: `"${e164}" site:onion.ly OR site:darkweblink.com` },
    { label: "Job / recruitment", query: `"${national}" (job OR recruitment OR hiring OR vacancy OR career)` },
    { label: "Cached versions",   query: `cache:"${national}"` },
  ], [e164, national]);

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
