"use client";

import { useMemo, useState } from "react";
import { ExternalLink, ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  e164: string;
  national: string;
  country?: string;
}

type AccessTier = "free" | "login" | "paid" | "captcha";

interface PivotLink {
  label: string;
  description: string;
  url: string;
  color: string;
  category: PivotCategory;
  access: AccessTier;
  usOnly?: boolean;
}

type PivotCategory = "identity" | "messaging" | "intel" | "social" | "spam" | "carrier";

const ACCESS_META: Record<AccessTier, { label: string; color: string; bg: string }> = {
  free:    { label: "FREE",     color: "#00ff41", bg: "rgba(0,255,65,0.10)" },
  captcha: { label: "CAPTCHA",  color: "#00d9ff", bg: "rgba(0,217,255,0.10)" },
  login:   { label: "LOGIN",    color: "#ffaa00", bg: "rgba(255,170,0,0.10)" },
  paid:    { label: "PAID",     color: "#ff6600", bg: "rgba(255,102,0,0.10)" },
};

function buildLinks(e164: string, national: string, country: string): PivotLink[] {
  const enc      = encodeURIComponent(e164);
  const encNat   = encodeURIComponent(national);
  const digits   = e164.replace(/\D/g, "");
  const ccLc     = (country || "us").toLowerCase();
  const noPlus   = e164.replace(/^\+/, "");

  return [
    // ── IDENTITY (free first) ────────────────────────────────────────────────
    { label: "OSINT Industries",       description: "Free phone-to-social account check — 100+ platforms", url: `https://osint.industries/?q=${enc}`,                                category: "identity",  color: "#00d9ff", access: "free"    },
    { label: "Epieos",                 description: "Free phone → Gravatar + Google services correlation",  url: `https://epieos.com/?q=${enc}&t=phone`,                              category: "identity",  color: "#00d9ff", access: "free"    },
    { label: "NumLookup",              description: "Free real-time carrier + CNAM lookup",                  url: `https://www.numlookup.com/${digits}`,                               category: "identity",  color: "#00d9ff", access: "free"    },
    { label: "Sync.me",                description: "Free preview · global reverse phone + social linking",  url: `https://sync.me/search/?number=${enc}`,                             category: "identity",  color: "#00d9ff", access: "free"    },
    { label: "Truecaller",             description: "Global crowd-sourced caller ID — 350M+ profiles",       url: `https://www.truecaller.com/search/${ccLc}/${digits}`,               category: "identity",  color: "#00d9ff", access: "login"   },
    { label: "Spy Dialer",             description: "Free voicemail-greeting reveals owner name",            url: `https://www.spydialer.com/`,                                        category: "identity",  color: "#00d9ff", access: "free"    },
    { label: "CallerSmart",            description: "Community-reported caller ID database",                 url: `https://www.callersmart.com/phone/${digits}`,                       category: "identity",  color: "#00d9ff", access: "free"    },
    { label: "TruePeopleSearch",       description: "Free US reverse lookup — name, address, relatives",     url: `https://www.truepeoplesearch.com/results?phoneno=${digits}`,        category: "identity",  color: "#00d9ff", access: "free",   usOnly: true },
    { label: "FastPeopleSearch",       description: "Free US reverse — name, address, age, relatives",        url: `https://www.fastpeoplesearch.com/${digits}`,                        category: "identity",  color: "#00d9ff", access: "free",   usOnly: true },
    { label: "USPhoneBook",            description: "US landline & mobile reverse lookup",                   url: `https://www.usphonebook.com/${digits}`,                             category: "identity",  color: "#00d9ff", access: "free",   usOnly: true },
    { label: "That's Them",            description: "US people search by phone — returns full profiles",     url: `https://thatsthem.com/phone/${digits}`,                             category: "identity",  color: "#00d9ff", access: "free",   usOnly: true },
    { label: "AnyWho",                 description: "AT&T-backed US reverse directory",                      url: `https://www.anywho.com/phone/${digits}`,                            category: "identity",  color: "#00d9ff", access: "free",   usOnly: true },
    { label: "ZabaSearch",             description: "US free people-search aggregator",                       url: `https://www.zabasearch.com/phone/${digits}/`,                       category: "identity",  color: "#00d9ff", access: "free",   usOnly: true },
    { label: "PeekYou",                description: "Social identity aggregator — links phone to profiles",  url: `https://www.peekyou.com/phone/${digits}`,                           category: "identity",  color: "#00d9ff", access: "free"    },
    { label: "Whitepages",             description: "US/CA reverse lookup — partial info free, full paid",   url: `https://www.whitepages.com/phone/${digits}`,                        category: "identity",  color: "#00d9ff", access: "paid",   usOnly: true },
    { label: "Spokeo",                 description: "US people-search aggregator",                            url: `https://www.spokeo.com/${digits}`,                                  category: "identity",  color: "#00d9ff", access: "paid",   usOnly: true },
    { label: "BeenVerified",           description: "US background & reverse phone — name, criminal, social",url: `https://www.beenverified.com/phone/${digits}/`,                     category: "identity",  color: "#00d9ff", access: "paid",   usOnly: true },
    { label: "Intelius",               description: "US deep background — identity, address history",         url: `https://www.intelius.com/phone-lookup/${digits}/`,                  category: "identity",  color: "#00d9ff", access: "paid",   usOnly: true },
    { label: "Pipl Search",            description: "Deep-web people search — premium tier",                  url: `https://pipl.com/`,                                                 category: "identity",  color: "#00d9ff", access: "paid"    },
    { label: "Radaris",                description: "US + international background — relatives, associates",  url: `https://radaris.com/p/${digits}`,                                   category: "identity",  color: "#00d9ff", access: "free"    },
    { label: "Infobel",                description: "International directory — 60+ countries",                 url: `https://www.infobel.com/en/world/search/?phone=${encNat}`,          category: "identity",  color: "#00d9ff", access: "free"    },

    // ── MESSAGING ─────────────────────────────────────────────────────────────
    { label: "WhatsApp",               description: "Opens chat — works only if registered. 2B+ users.",      url: `https://wa.me/${digits}`,                                           category: "messaging", color: "#25D366", access: "free" },
    { label: "Telegram",               description: "tg://resolve — opens app if registered (mobile-only)",   url: `tg://resolve?phone=${digits}`,                                      category: "messaging", color: "#2AABEE", access: "free" },
    { label: "Signal",                 description: "Signal deep-link — requires Signal installed",            url: `https://signal.me/#p/${enc}`,                                       category: "messaging", color: "#3A76F0", access: "free" },
    { label: "Viber",                  description: "Viber deep-link — opens chat if registered",              url: `viber://chat?number=${digits}`,                                     category: "messaging", color: "#7360f2", access: "free" },
    { label: "iMessage Check",         description: "macOS/iOS — Messages app shows blue if registered",       url: `sms:${e164}`,                                                       category: "messaging", color: "#34C759", access: "free" },
    { label: "Line",                   description: "Line messenger — popular in JP/TH/TW/ID",                  url: `https://line.me/R/ti/p/~${digits}`,                                 category: "messaging", color: "#00C300", access: "free" },
    { label: "KakaoTalk web",          description: "Korean dominant chat — search by phone inside the app",   url: `https://accounts.kakao.com/`,                                       category: "messaging", color: "#FAE100", access: "login" },
    { label: "WeChat search",          description: "WeChat — search phone number inside the installed app",   url: `https://web.wechat.com/`,                                           category: "messaging", color: "#7BB32E", access: "login" },

    // ── INTEL / BREACH ────────────────────────────────────────────────────────
    { label: "IntelligenceX",          description: "Free preview of deep-web hits and breach mentions",       url: `https://intelx.io/?s=${enc}`,                                       category: "intel",     color: "#ff3e3e", access: "free" },
    { label: "LeakCheck",              description: "Free web breach count — paid for full hashes",            url: `https://leakcheck.io/?query=${enc}`,                                category: "intel",     color: "#ff3e3e", access: "free" },
    { label: "Dehashed",               description: "First-page preview free — full results paid",              url: `https://dehashed.com/search?query=${enc}`,                          category: "intel",     color: "#ff3e3e", access: "paid" },
    { label: "HaveIBeenPwned",         description: "Captcha-only · paste digits into the phone-search box",   url: `https://haveibeenpwned.com/`,                                       category: "intel",     color: "#ff3e3e", access: "captcha" },
    { label: "Snusbase",               description: "Large breach DB — free count, paid full",                  url: `https://snusbase.com/search?term=${enc}`,                           category: "intel",     color: "#ff3e3e", access: "paid" },
    { label: "BreachDirectory",        description: "Open breach search — works with free RapidAPI tier",       url: `https://breachdirectory.org/?term=${enc}`,                          category: "intel",     color: "#ff3e3e", access: "free" },
    { label: "GhostProject",           description: "Free email/phone fuzz across credential dumps",            url: `https://ghostproject.fr/`,                                          category: "intel",     color: "#ff3e3e", access: "free" },
    { label: "Hudson Rock",            description: "Free infostealer search — already auto-checked above",     url: `https://www.hudsonrock.com/threat-intelligence-cybercrime-tools`,   category: "intel",     color: "#ff3e3e", access: "free" },
    { label: "SpyCloud",               description: "Enterprise breach clearinghouse",                          url: `https://spycloud.com/check-your-exposure/`,                         category: "intel",     color: "#ff3e3e", access: "login" },

    // ── SOCIAL / OPEN WEB (search engines + dorks) ───────────────────────────
    { label: "Google site:linkedin",   description: `site:linkedin.com "${e164}"`,                               url: `https://www.google.com/search?q=site:linkedin.com+%22${enc}%22`,     category: "social",    color: "#00ff41", access: "free" },
    { label: "Google site:facebook",   description: `site:facebook.com "${e164}"`,                               url: `https://www.google.com/search?q=site:facebook.com+%22${enc}%22`,     category: "social",    color: "#00ff41", access: "free" },
    { label: "Google site:instagram",  description: `site:instagram.com "${national}"`,                          url: `https://www.google.com/search?q=site:instagram.com+%22${encNat}%22`, category: "social",    color: "#00ff41", access: "free" },
    { label: "Google site:twitter/x",  description: `site:twitter.com OR site:x.com "${e164}"`,                  url: `https://www.google.com/search?q=(site:twitter.com+OR+site:x.com)+%22${enc}%22`, category: "social", color: "#00ff41", access: "free" },
    { label: "Google site:github",     description: `site:github.com "${e164}" — code repos, gists, issues`,    url: `https://www.google.com/search?q=site:github.com+%22${enc}%22`,       category: "social",    color: "#00ff41", access: "free" },
    { label: "Google site:pastebin",   description: `site:pastebin.com "${e164}" — leaked credentials`,          url: `https://www.google.com/search?q=site:pastebin.com+%22${enc}%22`,     category: "social",    color: "#00ff41", access: "free" },
    { label: "Google broad sweep",     description: `"${e164}" OR "${national}" — all public web`,               url: `https://www.google.com/search?q=%22${enc}%22+OR+%22${encNat}%22`,    category: "social",    color: "#00ff41", access: "free" },
    { label: "Bing",                   description: "Bing indexes different content than Google",                url: `https://www.bing.com/search?q=%22${enc}%22+OR+%22${encNat}%22`,      category: "social",    color: "#00ff41", access: "free" },
    { label: "DuckDuckGo",             description: "Privacy-focused engine",                                    url: `https://duckduckgo.com/?q=%22${enc}%22+OR+%22${encNat}%22`,          category: "social",    color: "#00ff41", access: "free" },
    { label: "Yandex",                 description: "Russian engine — best for E.Europe, MENA, CIS numbers",     url: `https://yandex.com/search/?text=${enc}`,                             category: "social",    color: "#00ff41", access: "free" },
    { label: "Baidu",                  description: "China's search engine — critical for CN/HK/TW numbers",     url: `https://www.baidu.com/s?wd=${enc}`,                                  category: "social",    color: "#00ff41", access: "free" },
    { label: "Google site:reddit",     description: `site:reddit.com "${e164}" — forum posts`,                   url: `https://www.google.com/search?q=site:reddit.com+%22${enc}%22`,       category: "social",    color: "#00ff41", access: "free" },
    { label: "Wayback Machine",        description: "Archived web snapshots — number may appear in deleted pages",url: `https://web.archive.org/web/*/${enc}`,                              category: "social",    color: "#00ff41", access: "free" },
    { label: "Google Maps",            description: "Find businesses or contacts linked to this number",          url: `https://www.google.com/maps/search/${encNat}`,                       category: "social",    color: "#00ff41", access: "free" },

    // ── SPAM / ABUSE ──────────────────────────────────────────────────────────
    { label: "800notes",               description: "Community spam call reports — US focused",                  url: `https://800notes.com/Phone.aspx/${digits}`,                          category: "spam",      color: "#ff8800", access: "free" },
    { label: "Should I Answer",        description: "Global spam & scam call ratings with comments",             url: `https://www.shouldianswer.com/phone-number/${digits}`,               category: "spam",      color: "#ff8800", access: "free" },
    { label: "Who Called Me",          description: "International spam call database",                           url: `https://www.whocalledme.com/Phone-Number.aspx/${digits}`,            category: "spam",      color: "#ff8800", access: "free" },
    { label: "SpamCalls.net",          description: "European-focused spam call directory",                       url: `https://www.spamcalls.net/en/number/${noPlus}`,                      category: "spam",      color: "#ff8800", access: "free" },
    { label: "Nomorobo",               description: "Robocall / telemarketer database",                            url: `https://www.nomorobo.com/lookup/${digits}`,                          category: "spam",      color: "#ff8800", access: "free" },
    { label: "IPQS public",            description: "IPQS free fraud-score preview (no signup needed)",            url: `https://www.ipqualityscore.com/free-phone-number-lookup/${enc}`,     category: "spam",      color: "#ff8800", access: "free" },
    { label: "CallTruth",              description: "US number reputation — spam score, complaint history",        url: `https://www.calltruth.com/call/${digits}`,                           category: "spam",      color: "#ff8800", access: "free" },

    // ── CARRIER / HLR ─────────────────────────────────────────────────────────
    { label: "FreeCarrierLookup",      description: "Free carrier lookup — confirms current carrier",             url: `https://freecarrierlookup.com/`,                                     category: "carrier",   color: "#888",    access: "captcha" },
    { label: "PhoneValidator",         description: "Free line type + carrier validator",                          url: `https://www.phonevalidator.com/results.aspx?phone=${digits}`,        category: "carrier",   color: "#888",    access: "free" },
    { label: "TextMagic Validator",    description: "Free online validator — line type, carrier, country",         url: `https://www.textmagic.com/free-tools/phone-validator`,               category: "carrier",   color: "#888",    access: "free" },
    { label: "OpenCNAM",               description: "CNAM lookup API — caller name from PSTN DB",                   url: `https://www.opencnam.com/`,                                          category: "carrier",   color: "#888",    access: "login" },
    { label: "HLR-Lookups",            description: "Real-time HLR — active? roaming? (paid, trial avail.)",        url: `https://www.hlr-lookups.com/`,                                       category: "carrier",   color: "#888",    access: "paid" },
    { label: "Twilio Lookup demo",     description: "Twilio Lookup API demo — line type, carrier, CNAM",            url: `https://www.twilio.com/lookup`,                                      category: "carrier",   color: "#888",    access: "login" },
    { label: "MNP portability check",  description: "Has the number been ported to another carrier?",                url: `https://www.mnpchecker.com/`,                                        category: "carrier",   color: "#888",    access: "login" },
  ];
}

const CATEGORY_META: Record<PivotCategory, { label: string; color: string }> = {
  identity:  { label: "IDENTITY / REVERSE LOOKUP",     color: "#00d9ff" },
  messaging: { label: "MESSAGING — IS IT REGISTERED?", color: "#25D366" },
  intel:     { label: "INTELLIGENCE / BREACH DATA",     color: "#ff3e3e" },
  social:    { label: "SOCIAL / OPEN WEB DORKS",        color: "#00ff41" },
  spam:      { label: "SPAM / ABUSE REPORTS",           color: "#ff8800" },
  carrier:   { label: "CARRIER / HLR / TELECOM",        color: "#888"    },
};

const CATEGORY_ORDER: PivotCategory[] = ["identity", "messaging", "intel", "social", "spam", "carrier"];
const TIER_ORDER: Record<AccessTier, number> = { free: 0, captcha: 1, login: 2, paid: 3 };

export default function OsintPivots({ e164, national, country = "us" }: Props) {
  const [activeFilters, setActiveFilters] = useState<Set<AccessTier>>(
    () => new Set<AccessTier>(["free", "captcha"])
  );
  const [collapsed, setCollapsed] = useState<Set<PivotCategory>>(new Set());

  const { links, byCategory, totalShown } = useMemo(() => {
    const all = buildLinks(e164, national, country);
    const filtered = all.filter((l) => activeFilters.has(l.access));
    // Sort each category by tier (free → captcha → login → paid)
    const grouped = filtered.reduce<Record<PivotCategory, PivotLink[]>>((acc, l) => {
      (acc[l.category] ??= []).push(l);
      return acc;
    }, {} as Record<PivotCategory, PivotLink[]>);
    for (const cat of CATEGORY_ORDER) {
      if (grouped[cat]) grouped[cat].sort((a, b) => TIER_ORDER[a.access] - TIER_ORDER[b.access]);
    }
    return {
      links: all,
      byCategory: CATEGORY_ORDER.map((cat) => ({ cat, items: grouped[cat] ?? [] })),
      totalShown: filtered.length,
    };
  }, [e164, national, country, activeFilters]);

  function toggleFilter(t: AccessTier) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next.size === 0 ? new Set<AccessTier>(["free"]) : next;
    });
  }

  function toggleCollapse(cat: PivotCategory) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="flex items-center justify-between border-b border-[#00ff41]/15 pb-2 flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-[#00ff41]/55">
          [ OSINT PIVOT MATRIX ] — {totalShown} / {links.length} shown
        </div>
        <div className="text-[11px] text-[#00ff41]/30 italic">
          Opens in new tab. Use within your authorised scope.
        </div>
      </div>

      {/* Access-tier filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-widest text-[#00ff41]/45 font-mono">Filter:</span>
        {(Object.keys(ACCESS_META) as AccessTier[]).map((t) => {
          const meta = ACCESS_META[t];
          const isActive = activeFilters.has(t);
          return (
            <button
              key={t}
              onClick={() => toggleFilter(t)}
              className="text-[11px] font-mono font-bold px-2 py-0.5 border tracking-widest transition-all"
              style={{
                color: isActive ? meta.color : meta.color + "55",
                borderColor: isActive ? meta.color + "75" : meta.color + "25",
                backgroundColor: isActive ? meta.bg : "transparent",
              }}
              title={isActive ? "Click to hide" : "Click to show"}
            >
              {isActive ? "●" : "○"} {meta.label}
            </button>
          );
        })}
      </div>

      {byCategory.map(({ cat, items }) =>
        items.length === 0 ? null : (
          <div key={cat} className="space-y-1.5">
            <button
              onClick={() => toggleCollapse(cat)}
              className="w-full flex items-center justify-between gap-2 text-[12px] uppercase tracking-widest font-mono pb-0.5 hover:opacity-100 opacity-80 transition-opacity"
              style={{ color: CATEGORY_META[cat].color + "85" }}
            >
              <span className="flex items-center gap-1">
                {collapsed.has(cat) ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                — {CATEGORY_META[cat].label} — ({items.length})
              </span>
            </button>

            {!collapsed.has(cat) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {items.map((link) => {
                  const accessMeta = ACCESS_META[link.access];
                  return (
                    <a
                      key={link.label}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 p-2.5 border border-[#00ff41]/10 hover:border-[#00ff41]/35 hover:bg-[#00ff41]/[0.04] transition-all"
                    >
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" style={{ color: link.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold truncate" style={{ color: link.color }}>
                            {link.label}
                          </span>
                          <span
                            className="text-[10px] font-mono font-bold px-1 tracking-widest"
                            style={{ color: accessMeta.color, backgroundColor: accessMeta.bg }}
                          >
                            {accessMeta.label}
                          </span>
                          {link.usOnly && (
                            <span className="text-[10px] text-[#00ff41]/30 font-normal">[US]</span>
                          )}
                        </div>
                        <div className="text-[12px] text-[#00ff41]/55 mt-0.5 leading-tight line-clamp-2">
                          {link.description}
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
