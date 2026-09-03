"use client";

import { useMemo, useState } from "react";
import PivotRow from "@/components/shared/PivotRow";
import {
  ACCESS_META, ALL_TIERS, DEFAULT_TIERS, TIER_ORDER, type AccessTier,
} from "@/lib/osint/accessTier";

interface Props {
  email: string;
  domain: string;
}

interface PivotLink {
  label: string;
  description: string;
  url: string;
  color: string;
  category: string;
  /**
   * What happens on click. This panel had no tiers at all, so Dehashed and
   * Snusbase rendered exactly like a free search engine — the analyst only
   * learned about the paywall after leaving the tool. `captcha` entries were
   * each confirmed by a request that came back as a bot-check interstitial.
   */
  access: AccessTier;
}

function buildLinks(email: string, domain: string): PivotLink[] {
  const enc = encodeURIComponent(email);
  const encDomain = encodeURIComponent(domain);

  return [
    // ── Breach / Data exposure ────────────────────────────────────────────────
    {
      label: "HaveIBeenPwned",
      description: "Check which data breaches exposed this email (paste into the search box)",
      url: `https://haveibeenpwned.com/`,
      color: "#ff3e3e", category: "breach", access: "captcha",
    },
    {
      label: "IntelligenceX",
      description: "Deep web, darknet, and breach archive search",
      url: `https://intelx.io/?s=${enc}`,
      color: "#ff3e3e", category: "breach", access: "login",
    },
    {
      label: "Dehashed",
      description: "Leaked credentials: find password, username, IP combos",
      url: `https://dehashed.com/search?query=${enc}`,
      color: "#ff3e3e", category: "breach", access: "paid",
    },
    {
      label: "LeakCheck",
      description: "Breach password lookup: plaintext and hashed",
      url: `https://leakcheck.io/?query=${enc}`,
      color: "#ff3e3e", category: "breach", access: "free",
    },
    {
      label: "Snusbase",
      description: "Database breach search: fast credential lookup",
      url: `https://snusbase.com/search?term=${enc}`,
      color: "#ff3e3e", category: "breach", access: "paid",
    },
    {
      label: "BreachDirectory",
      description: "Free breach search with password hash exposure",
      url: `https://breachdirectory.org/?term=${enc}`,
      color: "#ff3e3e", category: "breach", access: "captcha",
    },
    // ── Identity / OSINT correlation ─────────────────────────────────────────
    {
      label: "Epieos",
      description: "Email → phone, Google ID, social profile correlation",
      url: `https://epieos.com/?q=${enc}&t=email`,
      color: "#00d9ff", category: "identity", access: "login",
    },
    {
      label: "OSINT Industries",
      description: "Free email → 100+ platform account check",
      url: `https://osint.industries/?q=${enc}`,
      color: "#00d9ff", category: "identity", access: "login",
    },
    {
      label: "EmailRep.io",
      description: "Reputation score, platform registrations: paste the address",
      url: "https://emailrep.io/",
      color: "#00d9ff", category: "identity", access: "free",
    },
    {
      label: "That's Them",
      description: "US people search by email address",
      url: `https://thatsthem.com/email/${enc}`,
      color: "#00d9ff", category: "identity", access: "captcha",
    },
    {
      label: "Hunter.io Domain",
      description: "Find all public emails at the same domain",
      url: `https://hunter.io/domain-search?domain=${encDomain}`,
      color: "#00d9ff", category: "identity", access: "login",
    },
    {
      label: "Pipl Search",
      description: "Global people search by email (enterprise: paid)",
      url: `https://pipl.com/`,
      color: "#00d9ff", category: "identity", access: "paid",
    },
    // ── Social / open web ──────────────────────────────────────────────────────
    // Direct searches that return real result pages. We avoid narrow Google
    // `site:` dorks — for a specific email they almost always show Google's
    // "did not match any documents" page.
    {
      label: "GitHub Email Search",
      description: "Commits authored with this email address",
      url: `https://github.com/search?q=${enc}&type=commits`,
      color: "#00ff41", category: "social", access: "free",
    },
    {
      label: "Google",
      description: "Broad web search for the address",
      url: `https://www.google.com/search?q=${enc}`,
      color: "#00ff41", category: "social", access: "free",
    },
    {
      label: "Bing",
      description: "Indexes content Google may miss",
      url: `https://www.bing.com/search?q=${enc}`,
      color: "#00ff41", category: "social", access: "free",
    },
    {
      label: "DuckDuckGo",
      description: "Privacy-focused engine",
      url: `https://duckduckgo.com/?q=${enc}`,
      color: "#00ff41", category: "social", access: "free",
    },
    // ── Domain intelligence ───────────────────────────────────────────────────
    {
      label: "MXToolbox",
      description: "MX records, SPF, DKIM, DMARC: email infrastructure",
      url: `https://mxtoolbox.com/domain/${encDomain}`,
      color: "#888", category: "domain", access: "free",
    },
    {
      label: "WHOIS Lookup",
      description: "Domain registration, registrar, owner contact",
      url: `https://www.whois.com/whois/${encDomain}`,
      color: "#888", category: "domain", access: "free",
    },
    {
      label: "ViewDNS",
      description: "Reverse IP, DNS history, email server info",
      url: `https://viewdns.info/reversewhois/?q=${encDomain}`,
      color: "#888", category: "domain", access: "captcha",
    },
    {
      label: "Spamhaus Domain",
      description: "Check if email domain is on spam blacklists",
      url: `https://check.spamhaus.org/domain/${encDomain}`,
      color: "#888", category: "domain", access: "captcha",
    },
    {
      label: "SecurityTrails",
      description: "Historical DNS, subdomains, IP history for domain",
      url: `https://securitytrails.com/domain/${encDomain}/history/a`,
      color: "#888", category: "domain", access: "login",
    },
    {
      label: "Shodan Domain",
      description: "Exposed services and infrastructure for domain",
      url: `https://www.shodan.io/search?query=hostname%3A${encDomain}`,
      color: "#888", category: "domain", access: "login",
    },
  ];
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  breach:   { label: "BREACH / CREDENTIAL EXPOSURE",      color: "#ff3e3e" },
  identity: { label: "IDENTITY / OSINT CORRELATION",      color: "#00d9ff" },
  social:   { label: "SOCIAL MEDIA / OPEN WEB",           color: "#00ff41" },
  domain:   { label: "DOMAIN / INFRASTRUCTURE INTEL",     color: "#888"    },
};

const CATEGORY_ORDER = ["breach", "identity", "social", "domain"] as const;

export default function EmailOsintPivots({ email, domain }: Props) {
  const [activeFilters, setActiveFilters] = useState<Set<AccessTier>>(
    () => new Set<AccessTier>(DEFAULT_TIERS)
  );

  const { links, byCategory, totalShown } = useMemo(() => {
    const all = buildLinks(email, domain);
    const filtered = all.filter((l) => activeFilters.has(l.access));
    return {
      links: all,
      byCategory: CATEGORY_ORDER.map((cat) => ({
        cat,
        items: filtered
          .filter((l) => l.category === cat)
          .sort((a, b) => TIER_ORDER[a.access] - TIER_ORDER[b.access]),
      })),
      totalShown: filtered.length,
    };
  }, [email, domain, activeFilters]);

  function toggleFilter(t: AccessTier) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      // Never let every filter go off — an empty matrix reads as a broken panel.
      return next.size === 0 ? new Set<AccessTier>(["free"]) : next;
    });
  }

  return (
    <div className="terminal-card p-4 space-y-4">
      <div className="flex items-center justify-between border-b border-[#00ff41]/15 pb-2 flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-[#00ff41]/85">
          [ EMAIL OSINT MATRIX ]: {totalShown} / {links.length} shown
        </div>
        <div className="text-[11px] text-[#00ff41]/75 italic">
          Opens in new tab. Use only within your authorized scope.
        </div>
      </div>

      {/* Access-tier filter chips — same control, same meaning, as the phone matrix */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-widest text-[#00ff41]/85 font-mono">Filter:</span>
        {ALL_TIERS.map((t) => {
          const meta = ACCESS_META[t];
          const isActive = activeFilters.has(t);
          return (
            <button
              key={t}
              onClick={() => toggleFilter(t)}
              className="text-[11px] font-mono font-bold px-2 py-0.5 border tracking-widest transition-all"
              style={{
                color: isActive ? meta.color : meta.color + "d9",
                borderColor: isActive ? meta.color + "75" : meta.color + "55",
                backgroundColor: isActive ? meta.bg : "transparent",
              }}
              title={meta.hint}
            >
              {isActive ? "\u25cf" : "\u25cb"} {meta.label}
            </button>
          );
        })}
      </div>

      {byCategory.map(({ cat, items }) =>
        items.length === 0 ? null : (
          <div key={cat} className="space-y-1.5">
            <div
              className="text-[12px] uppercase tracking-widest font-mono pb-0.5"
              style={{ color: CATEGORY_META[cat].color }}
            >
             : {CATEGORY_META[cat].label}: ({items.length})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {items.map((link) => (
                <PivotRow key={link.label} link={link} />
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
