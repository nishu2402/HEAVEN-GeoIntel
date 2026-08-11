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

type PivotCategory = "identity" | "messaging" | "spam" | "carrier" | "search";

const ACCESS_META: Record<AccessTier, { label: string; color: string; bg: string }> = {
  free:    { label: "FREE",     color: "#00ff41", bg: "rgba(0,255,65,0.10)" },
  captcha: { label: "CAPTCHA",  color: "#00d9ff", bg: "rgba(0,217,255,0.10)" },
  login:   { label: "LOGIN",    color: "#ffaa00", bg: "rgba(255,170,0,0.10)" },
  paid:    { label: "PAID",     color: "#ff6600", bg: "rgba(255,102,0,0.10)" },
};

// ── Single source of truth for phone OSINT links ──────────────────────────────
// Curated, DEDUPLICATED, and only links that actually resolve to a results page.
// We deliberately do NOT generate narrow Google `site:` dorks (e.g.
// site:facebook.com "+1…"): for a specific number those almost always return
// Google's "did not match any documents" page, which is noise. Broad web search
// lives in the SEARCH group below using un-quoted queries that return real pages.
function buildLinks(e164: string, national: string, country: string): PivotLink[] {
  const enc      = encodeURIComponent(e164);
  const encNat   = encodeURIComponent(national);
  const digits   = e164.replace(/\D/g, "");
  const ccLc     = (country || "us").toLowerCase();
  const noPlus   = e164.replace(/^\+/, "");
  const C = { id: "#00d9ff", msg: "#25D366", intel: "#ff3e3e", spam: "#ff8800", carrier: "#a8b6c8", search: "#00ff41" };

  return [
    // ── IDENTITY / REVERSE LOOKUP (the number goes into the URL) ───────────────
    { label: "OSINT Industries",  description: "Phone → account check across 100+ platforms",        url: `https://osint.industries/?q=${enc}`,                          category: "identity", color: C.id, access: "free"  },
    { label: "Epieos",            description: "Phone → Gravatar + Google-services correlation",      url: `https://epieos.com/?q=${enc}&t=phone`,                         category: "identity", color: C.id, access: "free"  },
    { label: "NumLookup",         description: "Real-time carrier + CNAM + line type",                url: `https://www.numlookup.com/${digits}`,                          category: "identity", color: C.id, access: "free"  },
    { label: "Sync.me",           description: "Reverse phone + social-account linking (preview)",     url: `https://sync.me/search/?number=${enc}`,                        category: "identity", color: C.id, access: "free"  },
    { label: "Spy Dialer",        description: "Voicemail-greeting + owner name lookup",               url: `https://www.spydialer.com/default.aspx?n=${digits}`,           category: "identity", color: C.id, access: "free"  },
    { label: "CallerSmart",       description: "Community-reported caller-ID database",                url: `https://www.callersmart.com/phone/${digits}`,                  category: "identity", color: C.id, access: "free"  },
    { label: "PeekYou",           description: "Social identity aggregator by phone",                  url: `https://www.peekyou.com/phone/${digits}`,                      category: "identity", color: C.id, access: "free"  },
    { label: "Radaris",           description: "Background: relatives, associates, addresses",         url: `https://radaris.com/p/${digits}`,                              category: "identity", color: C.id, access: "free"  },
    { label: "Infobel",           description: "International directory — 60+ countries",              url: `https://www.infobel.com/en/world/search/?phone=${encNat}`,     category: "identity", color: C.id, access: "free"  },
    { label: "Truecaller",        description: "Global crowd-sourced caller ID — 350M+ profiles",      url: `https://www.truecaller.com/search/${ccLc}/${digits}`,          category: "identity", color: C.id, access: "login" },
    { label: "TruePeopleSearch",  description: "Name, address, relatives",                             url: `https://www.truepeoplesearch.com/results?phoneno=${digits}`,   category: "identity", color: C.id, access: "free",  usOnly: true },
    { label: "FastPeopleSearch",  description: "Name, address, age, relatives",                        url: `https://www.fastpeoplesearch.com/${digits}`,                   category: "identity", color: C.id, access: "free",  usOnly: true },
    { label: "USPhoneBook",       description: "Landline & mobile reverse lookup",                     url: `https://www.usphonebook.com/${digits}`,                        category: "identity", color: C.id, access: "free",  usOnly: true },
    { label: "That's Them",       description: "People search by phone — full profiles",               url: `https://thatsthem.com/phone/${digits}`,                        category: "identity", color: C.id, access: "free",  usOnly: true },
    { label: "ZabaSearch",        description: "Free people-search aggregator",                        url: `https://www.zabasearch.com/phone/${digits}/`,                  category: "identity", color: C.id, access: "free",  usOnly: true },
    { label: "Whitepages",        description: "Reverse lookup — partial free, full paid",             url: `https://www.whitepages.com/phone/${digits}`,                   category: "identity", color: C.id, access: "paid",  usOnly: true },
    { label: "Spokeo",            description: "People-search aggregator",                             url: `https://www.spokeo.com/${digits}`,                             category: "identity", color: C.id, access: "paid",  usOnly: true },
    { label: "BeenVerified",      description: "Background + reverse phone (name, social)",            url: `https://www.beenverified.com/phone/${digits}/`,                category: "identity", color: C.id, access: "paid",  usOnly: true },

    // ── MESSAGING — is the number registered? ──────────────────────────────────
    { label: "WhatsApp",          description: "Opens chat if registered — 2B+ users",                 url: `https://wa.me/${digits}`,                                      category: "messaging", color: C.msg, access: "free" },
    { label: "Telegram",          description: "Deep link — opens app if registered (mobile)",         url: `tg://resolve?phone=${digits}`,                                 category: "messaging", color: "#2AABEE", access: "free" },
    { label: "Signal",            description: "Deep link — requires Signal installed",                url: `https://signal.me/#p/${enc}`,                                  category: "messaging", color: "#6d9bff", access: "free" },
    { label: "Viber",             description: "Deep link — opens chat if registered",                 url: `viber://chat?number=${digits}`,                                category: "messaging", color: "#8f7cff", access: "free" },
    { label: "iMessage",          description: "macOS/iOS Messages shows blue if registered",          url: `sms:${e164}`,                                                  category: "messaging", color: "#34C759", access: "free" },
    { label: "Line",              description: "Popular in JP/TH/TW/ID",                               url: `https://line.me/R/ti/p/~${digits}`,                            category: "messaging", color: "#00C300", access: "free" },

    // NOTE: breach/credential lookups (HaveIBeenPwned, IntelligenceX, LeakCheck,
    // Dehashed, Snusbase, BreachDirectory) intentionally live ONLY in the
    // dedicated CREDENTIAL BREACH SEARCH panel above — not duplicated here.

    // ── SPAM / ABUSE REPORTS ───────────────────────────────────────────────────
    { label: "800notes",          description: "Community spam-call reports",                          url: `https://800notes.com/Phone.aspx/${digits}`,                    category: "spam", color: C.spam, access: "free" },
    { label: "Should I Answer",   description: "Global spam/scam ratings + comments",                  url: `https://www.shouldianswer.com/phone-number/${digits}`,         category: "spam", color: C.spam, access: "free" },
    { label: "Who Called Me",     description: "International spam-call database",                      url: `https://who-called.co.uk/Number/${digits}`,                    category: "spam", color: C.spam, access: "free" },
    { label: "SpamCalls.net",     description: "European-focused spam directory",                      url: `https://www.spamcalls.net/en/number/${noPlus}`,                category: "spam", color: C.spam, access: "free" },
    { label: "Nomorobo",          description: "Robocall / telemarketer database",                     url: `https://www.nomorobo.com/lookup/${digits}`,                    category: "spam", color: C.spam, access: "free" },
    { label: "IPQS Phone",        description: "Free fraud-score preview (no signup)",                 url: `https://www.ipqualityscore.com/free-phone-number-lookup/${enc}`,category: "spam", color: C.spam, access: "free" },

    // ── CARRIER / HLR / TELECOM ────────────────────────────────────────────────
    { label: "PhoneValidator",    description: "Line type + carrier validator",                        url: `https://www.phonevalidator.com/results.aspx?phone=${digits}`,  category: "carrier", color: C.carrier, access: "free" },
    { label: "FreeCarrierLookup", description: "Confirms current carrier (paste the number)",          url: `https://freecarrierlookup.com/`,                               category: "carrier", color: C.carrier, access: "captcha" },
    { label: "HLR-Lookups",       description: "Real-time HLR — active? roaming? (trial)",             url: `https://www.hlr-lookups.com/`,                                 category: "carrier", color: C.carrier, access: "paid" },

    // ── SEARCH ENGINES — broad, un-quoted (returns real result pages) ──────────
    { label: "Google",            description: "Broad web search for the number",                      url: `https://www.google.com/search?q=${enc}`,                       category: "search", color: C.search, access: "free" },
    { label: "Bing",              description: "Indexes content Google may miss",                      url: `https://www.bing.com/search?q=${enc}`,                         category: "search", color: C.search, access: "free" },
    { label: "DuckDuckGo",        description: "Privacy-focused engine",                               url: `https://duckduckgo.com/?q=${enc}`,                             category: "search", color: C.search, access: "free" },
    { label: "Yandex",            description: "Best for E.Europe / MENA / CIS numbers",               url: `https://yandex.com/search/?text=${enc}`,                       category: "search", color: C.search, access: "free" },
    { label: "Wayback Machine",   description: "Archived pages that may mention the number",           url: `https://web.archive.org/web/*/${enc}`,                         category: "search", color: C.search, access: "free" },
  ];
}

const CATEGORY_META: Record<PivotCategory, { label: string; color: string }> = {
  identity:  { label: "IDENTITY / REVERSE LOOKUP",     color: "#00d9ff" },
  messaging: { label: "MESSAGING — IS IT REGISTERED?", color: "#25D366" },
  spam:      { label: "SPAM / ABUSE REPORTS",           color: "#ff8800" },
  carrier:   { label: "CARRIER / HLR / TELECOM",        color: "#a8b6c8" },
  search:    { label: "SEARCH ENGINES (BROAD)",         color: "#00ff41" },
};

const CATEGORY_ORDER: PivotCategory[] = ["identity", "messaging", "spam", "carrier", "search"];
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
        <div className="text-xs uppercase tracking-widest text-[#00ff41]/85">
          [ OSINT PIVOT MATRIX ] — {totalShown} / {links.length} shown
        </div>
        <div className="text-[11px] text-[#00ff41]/75 italic">
          Opens in new tab. Use within your authorised scope.
        </div>
      </div>

      {/* Access-tier filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-widest text-[#00ff41]/85 font-mono">Filter:</span>
        {(Object.keys(ACCESS_META) as AccessTier[]).map((t) => {
          const meta = ACCESS_META[t];
          const isActive = activeFilters.has(t);
          return (
            <button
              key={t}
              onClick={() => toggleFilter(t)}
              className="text-[11px] font-mono font-bold px-2 py-0.5 border tracking-widest transition-all"
              style={{
                // d9 = 85%. An inactive filter still has to be readable to be
                // clickable, and `paid` (#ff6600) is the darkest of the four —
                // it only clears 4.5:1 on the panel from 83% up.
                color: isActive ? meta.color : meta.color + "d9",
                borderColor: isActive ? meta.color + "75" : meta.color + "55",
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
              className="w-full flex items-center justify-between gap-2 text-[12px] uppercase tracking-widest font-mono pb-0.5 hover:opacity-100 opacity-95 transition-opacity"
              style={{ color: CATEGORY_META[cat].color }}
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
                            <span className="text-[10px] text-[#00ff41]/75 font-normal">[US]</span>
                          )}
                        </div>
                        <div className="text-[12px] text-[#00ff41]/85 mt-0.5 leading-tight line-clamp-2">
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
