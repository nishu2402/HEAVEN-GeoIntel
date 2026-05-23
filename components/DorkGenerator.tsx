"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Check, ExternalLink, ChevronDown, ChevronRight, Layers } from "lucide-react";
import { copyText } from "@/lib/utils";

interface Props {
  e164: string;
  national: string;
}

type DorkCategory = "basic" | "social" | "files" | "creds" | "code" | "chat" | "biz" | "legal";

interface Dork {
  label: string;
  query: string;
  category: DorkCategory;
  /** subjective hit-rate estimate to help users pick the best dorks */
  hitRate: "high" | "medium" | "low";
}

type SearchEngine = "google" | "duckduckgo" | "bing" | "yandex" | "brave";

const SEARCH_ENGINES: Record<SearchEngine, { label: string; url: (q: string) => string }> = {
  google:     { label: "Google",     url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  duckduckgo: { label: "DuckDuckGo", url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  bing:       { label: "Bing",       url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  yandex:     { label: "Yandex",     url: (q) => `https://yandex.com/search/?text=${encodeURIComponent(q)}` },
  brave:      { label: "Brave",      url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
};

const CATEGORY_META: Record<DorkCategory, { label: string; color: string; icon: string }> = {
  basic:  { label: "BASIC FORMATS",        color: "#00ff41", icon: "●" },
  social: { label: "SOCIAL PLATFORMS",     color: "#00d9ff", icon: "◆" },
  files:  { label: "FILE / DOCUMENT LEAKS", color: "#ffaa00", icon: "▼" },
  creds:  { label: "CREDENTIALS / BREACH",  color: "#ff3e3e", icon: "▲" },
  code:   { label: "CODE / PASTE SITES",    color: "#bf5fff", icon: "</" + ">" },
  chat:   { label: "CHAT / MESSAGING",       color: "#25D366", icon: "✉" },
  biz:    { label: "BUSINESS / DIRECTORIES", color: "#ff8800", icon: "▣" },
  legal:  { label: "LEGAL / PUBLIC RECORDS", color: "#888888", icon: "§" },
};

const HIT_RATE_META: Record<Dork["hitRate"], { label: string; color: string }> = {
  high:   { label: "HIGH",   color: "#00ff41" },
  medium: { label: "MED",    color: "#ffaa00" },
  low:    { label: "LOW",    color: "#888"    },
};

function buildDorks(e164: string, national: string): Dork[] {
  const digits = e164.replace(/\D/g, "");
  const spaced = digits.split("").join(" ");
  const noPlus = e164.replace(/^\+/, "");
  const dashed = national.replace(/[\s()]/g, "").replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");

  return [
    // ── BASIC ─────────────────────────────────────────────────────────────
    { label: "Exact E.164",           query: `"${e164}"`,                                                    category: "basic",  hitRate: "high" },
    { label: "National format",       query: `"${national}"`,                                                category: "basic",  hitRate: "high" },
    { label: "All formats",           query: `"${e164}" OR "${national}" OR "${digits}"`,                    category: "basic",  hitRate: "high" },
    { label: "Digits only",           query: `"${digits}"`,                                                  category: "basic",  hitRate: "medium" },
    { label: "Dashed format",         query: `"${dashed}"`,                                                  category: "basic",  hitRate: "medium" },
    { label: "Spaced digits",         query: `"${spaced}"`,                                                  category: "basic",  hitRate: "low" },
    { label: "WhatsApp wa.me link",   query: `"wa.me/${digits}"`,                                            category: "basic",  hitRate: "medium" },

    // ── SOCIAL ────────────────────────────────────────────────────────────
    { label: "LinkedIn",              query: `site:linkedin.com "${e164}"`,                                  category: "social", hitRate: "high" },
    { label: "LinkedIn (national)",   query: `site:linkedin.com "${national}"`,                              category: "social", hitRate: "medium" },
    { label: "Facebook",              query: `site:facebook.com "${e164}" OR "${national}"`,                 category: "social", hitRate: "high" },
    { label: "Twitter / X",           query: `(site:twitter.com OR site:x.com) "${e164}"`,                   category: "social", hitRate: "medium" },
    { label: "Instagram bio",         query: `site:instagram.com "${national}"`,                             category: "social", hitRate: "medium" },
    { label: "TikTok bio",            query: `site:tiktok.com "${national}"`,                                category: "social", hitRate: "low" },
    { label: "YouTube About",         query: `site:youtube.com "${national}"`,                               category: "social", hitRate: "low" },
    { label: "Reddit posts",          query: `site:reddit.com "${e164}" OR "${national}"`,                   category: "social", hitRate: "medium" },
    { label: "Pinterest",             query: `site:pinterest.com "${national}"`,                             category: "social", hitRate: "low" },

    // ── FILES ─────────────────────────────────────────────────────────────
    { label: "PDF documents",         query: `"${e164}" filetype:pdf`,                                       category: "files",  hitRate: "high" },
    { label: "Excel / CSV",           query: `"${e164}" (filetype:xls OR filetype:xlsx OR filetype:csv)`,    category: "files",  hitRate: "high" },
    { label: "Word documents",        query: `"${e164}" (filetype:doc OR filetype:docx)`,                    category: "files",  hitRate: "medium" },
    { label: "Text / log files",      query: `"${e164}" (filetype:txt OR filetype:log)`,                     category: "files",  hitRate: "high" },
    { label: "SQL dumps",             query: `"${e164}" filetype:sql`,                                       category: "files",  hitRate: "high" },
    { label: "JSON / XML data",       query: `"${e164}" (filetype:json OR filetype:xml)`,                    category: "files",  hitRate: "medium" },
    { label: ".env / config leak",    query: `"${e164}" (filetype:env OR filetype:cfg OR filetype:conf OR filetype:yaml)`, category: "files", hitRate: "medium" },

    // ── CREDENTIALS / BREACH ──────────────────────────────────────────────
    { label: "Credentials nearby",    query: `"${e164}" (password OR passwd OR pwd OR credentials OR leak OR breach)`,    category: "creds", hitRate: "high" },
    { label: "Database dumps",        query: `"${e164}" (dump OR database OR "db.sql" OR backup)`,           category: "creds",  hitRate: "high" },
    { label: "Password hashes",       query: `"${e164}" (md5 OR sha1 OR sha256 OR hash OR bcrypt)`,          category: "creds",  hitRate: "medium" },
    { label: "API keys near number",  query: `"${e164}" (api_key OR apikey OR secret OR token OR bearer)`,   category: "creds",  hitRate: "low" },
    { label: "Combo list pattern",    query: `"${e164}" ("@gmail.com" OR "@yahoo.com" OR "@hotmail.com" OR "@outlook.com")`, category: "creds", hitRate: "high" },
    { label: "S3 bucket leak",        query: `"${e164}" (site:s3.amazonaws.com OR site:storage.googleapis.com OR site:blob.core.windows.net)`, category: "creds", hitRate: "medium" },

    // ── CODE / PASTE ──────────────────────────────────────────────────────
    { label: "Pastebin",              query: `site:pastebin.com "${e164}"`,                                  category: "code",   hitRate: "high" },
    { label: "Paste mirrors",         query: `(site:paste.org OR site:hastebin.com OR site:ghostbin.com OR site:rentry.co) "${e164}"`, category: "code", hitRate: "medium" },
    { label: "GitHub code",           query: `site:github.com "${e164}"`,                                    category: "code",   hitRate: "high" },
    { label: "GitHub Gist",           query: `site:gist.github.com "${e164}"`,                               category: "code",   hitRate: "medium" },
    { label: "GitLab",                query: `site:gitlab.com "${e164}"`,                                    category: "code",   hitRate: "medium" },
    { label: "Bitbucket",             query: `site:bitbucket.org "${e164}"`,                                 category: "code",   hitRate: "low" },
    { label: "StackOverflow",         query: `site:stackoverflow.com "${e164}" OR "${national}"`,            category: "code",   hitRate: "low" },

    // ── CHAT / MESSAGING ──────────────────────────────────────────────────
    { label: "WhatsApp groups",       query: `site:chat.whatsapp.com "${e164}" OR "${digits}"`,              category: "chat",   hitRate: "medium" },
    { label: "Telegram public",       query: `site:t.me "${e164}" OR "${digits}"`,                           category: "chat",   hitRate: "medium" },
    { label: "Discord invites",       query: `(site:discord.gg OR site:discord.com) "${e164}"`,              category: "chat",   hitRate: "low" },
    { label: "Slack workspace",       query: `site:slack.com "${e164}"`,                                     category: "chat",   hitRate: "low" },
    { label: "Skype directory",       query: `site:skype.com "${e164}" OR "${digits}"`,                      category: "chat",   hitRate: "low" },

    // ── BUSINESS ──────────────────────────────────────────────────────────
    { label: "Contact pages",         query: `"${e164}" (contact OR "call us" OR "reach us" OR phone OR tel)`, category: "biz", hitRate: "high" },
    { label: "Resume / CV",           query: `"${national}" (resume OR CV OR "curriculum vitae") filetype:pdf`, category: "biz", hitRate: "medium" },
    { label: "Business listing",      query: `"${national}" (company OR business OR LLC OR Inc OR Ltd)`,     category: "biz",    hitRate: "medium" },
    { label: "Yelp",                  query: `site:yelp.com "${national}"`,                                  category: "biz",    hitRate: "medium" },
    { label: "BBB",                   query: `site:bbb.org "${national}"`,                                   category: "biz",    hitRate: "low" },
    { label: "Yellow Pages",          query: `site:yellowpages.com "${national}"`,                           category: "biz",    hitRate: "low" },
    { label: "Google Maps biz",       query: `"${national}" (site:maps.google.com OR site:google.com/maps)`, category: "biz",    hitRate: "medium" },
    { label: "Trustpilot reviews",    query: `site:trustpilot.com "${national}"`,                            category: "biz",    hitRate: "low" },

    // ── LEGAL / RECORDS ───────────────────────────────────────────────────
    { label: "Court records",         query: `"${national}" (court OR case OR lawsuit OR plaintiff OR defendant)`, category: "legal", hitRate: "low" },
    { label: "Public records",        query: `"${national}" ("public record" OR government OR .gov)`,        category: "legal",  hitRate: "low" },
    { label: "SEC filings",           query: `"${national}" (site:sec.gov OR site:edgar.sec.gov)`,           category: "legal",  hitRate: "low" },
    { label: "WHOIS / domain",        query: `"${national}" (site:whois.com OR site:who.is OR site:domaintools.com)`, category: "legal", hitRate: "low" },
    { label: "Real estate",           query: `"${national}" (realtor OR zillow OR redfin OR property)`,      category: "legal",  hitRate: "low" },
    { label: "News mention",          query: `"${e164}" OR "${national}" (news OR press OR article OR journalist)`, category: "legal", hitRate: "medium" },
    { label: "Job postings",          query: `"${national}" (job OR recruitment OR hiring OR vacancy OR career)`, category: "legal", hitRate: "low" },
    { label: "Archive.org snapshot",  query: `site:web.archive.org "${e164}"`,                               category: "legal",  hitRate: "low" },
    // noPlus is offered as an alternate form for legacy directory sites
    { label: "Numeric (no +)",        query: `"${noPlus}"`,                                                   category: "basic",  hitRate: "low" },
  ];
}

export default function DorkGenerator({ e164, national }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [engine, setEngine] = useState<SearchEngine>("google");
  const [collapsed, setCollapsed] = useState<Set<DorkCategory>>(new Set());
  const [hitRateFilter, setHitRateFilter] = useState<Set<Dork["hitRate"]>>(
    () => new Set<Dork["hitRate"]>(["high", "medium", "low"])
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const dorks = useMemo(() => buildDorks(e164, national), [e164, national]);

  const grouped = useMemo(() => {
    const filtered = dorks.filter((d) => hitRateFilter.has(d.hitRate));
    const out: Record<DorkCategory, Dork[]> = {} as Record<DorkCategory, Dork[]>;
    for (const d of filtered) {
      (out[d.category] ??= []).push(d);
    }
    return out;
  }, [dorks, hitRateFilter]);

  const totalShown = useMemo(
    () => Object.values(grouped).reduce((a, list) => a + list.length, 0),
    [grouped]
  );

  const topDorks = useMemo(
    () => dorks.filter((d) => d.hitRate === "high").slice(0, 6),
    [dorks]
  );

  const copy = (text: string, key: string) => {
    void copyText(text);
    setCopiedKey(key);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedKey(null), 1500);
  };

  function openMany(queries: string[]) {
    const eng = SEARCH_ENGINES[engine];
    for (const q of queries) {
      window.open(eng.url(q), "_blank", "noopener,noreferrer");
    }
  }

  function toggleCollapse(cat: DorkCategory) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  function toggleHitRate(r: Dork["hitRate"]) {
    setHitRateFilter((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next.size === 0 ? new Set<Dork["hitRate"]>(["high"]) : next;
    });
  }

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="flex items-center justify-between border-b border-[#00ff41]/15 pb-2 flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-[#00ff41]/55 flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" />
          [ DORK GENERATOR ] — {totalShown} / {dorks.length} shown
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-widest text-[#00ff41]/45 font-mono">Engine:</span>
          {(Object.keys(SEARCH_ENGINES) as SearchEngine[]).map((k) => (
            <button
              key={k}
              onClick={() => setEngine(k)}
              className={`text-[11px] font-mono px-2 py-0.5 border tracking-widest transition-all ${
                engine === k
                  ? "border-[#00d9ff] text-[#00d9ff] bg-[#00d9ff]/10"
                  : "border-[#00d9ff]/25 text-[#00d9ff]/50 hover:border-[#00d9ff]/50 hover:text-[#00d9ff]/75"
              }`}
            >
              {SEARCH_ENGINES[k].label}
            </button>
          ))}
        </div>
      </div>

      {/* Top-picks quick action row */}
      <div className="flex items-center gap-2 flex-wrap border border-[#00ff41]/15 bg-[#00ff41]/[0.04] px-3 py-2">
        <div className="text-[11px] uppercase tracking-widest text-[#00ff41]/65 font-mono">
          ★ TOP {topDorks.length} HIGH-HIT-RATE
        </div>
        <button
          onClick={() => openMany(topDorks.map((d) => d.query))}
          className="text-[11px] font-mono font-bold px-2 py-1 border border-[#00ff41]/55 text-[#00ff41] bg-[#00ff41]/10 hover:bg-[#00ff41]/20 transition-colors tracking-widest"
        >
          OPEN ALL IN {SEARCH_ENGINES[engine].label.toUpperCase()}
        </button>
        <button
          onClick={() => copy(topDorks.map((d) => d.query).join("\n"), "top-pack")}
          className="text-[11px] font-mono px-2 py-1 border border-[#00ff41]/35 text-[#00ff41]/80 hover:bg-[#00ff41]/5 transition-colors flex items-center gap-1"
        >
          {copiedKey === "top-pack" ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
          {copiedKey === "top-pack" ? "COPIED" : "COPY ALL"}
        </button>
      </div>

      {/* Hit-rate filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-widest text-[#00ff41]/45 font-mono">Show hit rate:</span>
        {(Object.keys(HIT_RATE_META) as Dork["hitRate"][]).map((r) => {
          const meta = HIT_RATE_META[r];
          const isActive = hitRateFilter.has(r);
          return (
            <button
              key={r}
              onClick={() => toggleHitRate(r)}
              className="text-[11px] font-mono font-bold px-2 py-0.5 border tracking-widest transition-all"
              style={{
                color: isActive ? meta.color : meta.color + "55",
                borderColor: isActive ? meta.color + "75" : meta.color + "25",
                backgroundColor: isActive ? meta.color + "18" : "transparent",
              }}
            >
              {isActive ? "●" : "○"} {meta.label}
            </button>
          );
        })}
      </div>

      {/* Category groups */}
      {(Object.keys(CATEGORY_META) as DorkCategory[]).map((cat) => {
        const items = grouped[cat] ?? [];
        if (items.length === 0) return null;
        const meta = CATEGORY_META[cat];
        const isCollapsed = collapsed.has(cat);

        return (
          <div key={cat} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <button
                onClick={() => toggleCollapse(cat)}
                className="flex items-center gap-1.5 text-[12px] uppercase tracking-widest font-mono pb-0.5 hover:opacity-100 opacity-90 transition-opacity"
                style={{ color: meta.color }}
              >
                {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                <span style={{ color: meta.color }}>{meta.icon}</span>
                {meta.label}
                <span className="text-[#00ff41]/45 font-normal normal-case">({items.length})</span>
              </button>

              <button
                onClick={() => openMany(items.map((d) => d.query))}
                className="text-[10px] font-mono px-1.5 py-0.5 border tracking-widest hover:bg-[#00ff41]/5 transition-colors"
                style={{ color: meta.color + "AA", borderColor: meta.color + "40" }}
                title={`Open all ${items.length} dorks in ${SEARCH_ENGINES[engine].label}`}
              >
                OPEN {items.length}
              </button>
            </div>

            {!isCollapsed && (
              <div className="divide-y divide-[#00ff41]/[0.06] border border-[#00ff41]/10">
                {items.map((d) => {
                  const isCopied = copiedKey === d.label;
                  const hitMeta = HIT_RATE_META[d.hitRate];
                  return (
                    <div
                      key={d.label}
                      className="flex items-center gap-2 py-1.5 px-2 hover:bg-[#00ff41]/[0.04] transition-colors group"
                    >
                      <div className="w-36 sm:w-40 shrink-0 flex items-center gap-1.5">
                        <span
                          className="text-[10px] font-mono font-bold px-1 py-0 tracking-widest"
                          style={{ color: hitMeta.color, backgroundColor: hitMeta.color + "18" }}
                          title={`${hitMeta.label} hit rate`}
                        >
                          {hitMeta.label}
                        </span>
                        <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/65 truncate">
                          {d.label}
                        </span>
                      </div>
                      <span
                        className="font-mono text-[13px] text-[#00ff41]/70 flex-1 min-w-0 truncate"
                        title={d.query}
                      >
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
                          href={SEARCH_ENGINES[engine].url(d.query)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-[#00ff41]/45 hover:text-[#00d9ff] transition-colors"
                          title={`Open in ${SEARCH_ENGINES[engine].label}`}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className="text-[11px] font-mono text-[#00ff41]/30 italic pt-1">
        Phone-number dorks have inherently lower hit rates than email dorks because numbers
        rarely appear verbatim on the public web. HIGH hit-rate queries combine the number
        with credential, file, or social-platform keywords for better recall.
      </div>
    </div>
  );
}
