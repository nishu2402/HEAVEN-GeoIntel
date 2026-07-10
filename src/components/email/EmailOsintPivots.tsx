"use client";

import { ExternalLink } from "lucide-react";

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
      color: "#ff3e3e", category: "breach",
    },
    {
      label: "IntelligenceX",
      description: "Deep web, darknet, and breach archive search",
      url: `https://intelx.io/?s=${enc}`,
      color: "#ff3e3e", category: "breach",
    },
    {
      label: "Dehashed",
      description: "Leaked credentials — find password, username, IP combos",
      url: `https://dehashed.com/search?query=${enc}`,
      color: "#ff3e3e", category: "breach",
    },
    {
      label: "LeakCheck",
      description: "Breach password lookup — plaintext and hashed",
      url: `https://leakcheck.io/?query=${enc}`,
      color: "#ff3e3e", category: "breach",
    },
    {
      label: "Snusbase",
      description: "Database breach search — fast credential lookup",
      url: `https://snusbase.com/search?term=${enc}`,
      color: "#ff3e3e", category: "breach",
    },
    {
      label: "BreachDirectory",
      description: "Free breach search with password hash exposure",
      url: `https://breachdirectory.org/?term=${enc}`,
      color: "#ff3e3e", category: "breach",
    },
    // ── Identity / OSINT correlation ─────────────────────────────────────────
    {
      label: "Epieos",
      description: "Email → phone, Google ID, social profile correlation",
      url: `https://epieos.com/?q=${enc}&t=email`,
      color: "#00d9ff", category: "identity",
    },
    {
      label: "OSINT Industries",
      description: "Free email → 100+ platform account check",
      url: `https://osint.industries/?q=${enc}`,
      color: "#00d9ff", category: "identity",
    },
    {
      label: "EmailRep.io",
      description: "Reputation score, platform registrations, breach history",
      url: `https://emailrep.io/${enc}`,
      color: "#00d9ff", category: "identity",
    },
    {
      label: "That's Them",
      description: "US people search by email address",
      url: `https://thatsthem.com/email/${enc}`,
      color: "#00d9ff", category: "identity",
    },
    {
      label: "Hunter.io Domain",
      description: "Find all public emails at the same domain",
      url: `https://hunter.io/domain-search?domain=${encDomain}`,
      color: "#00d9ff", category: "identity",
    },
    {
      label: "Pipl Search",
      description: "Global people search by email (enterprise — paid)",
      url: `https://pipl.com/`,
      color: "#00d9ff", category: "identity",
    },
    // ── Social / open web ──────────────────────────────────────────────────────
    // Direct searches that return real result pages. We avoid narrow Google
    // `site:` dorks — for a specific email they almost always show Google's
    // "did not match any documents" page.
    {
      label: "GitHub Email Search",
      description: "Commits authored with this email address",
      url: `https://github.com/search?q=${enc}&type=commits`,
      color: "#00ff41", category: "social",
    },
    {
      label: "Google",
      description: "Broad web search for the address",
      url: `https://www.google.com/search?q=${enc}`,
      color: "#00ff41", category: "social",
    },
    {
      label: "Bing",
      description: "Indexes content Google may miss",
      url: `https://www.bing.com/search?q=${enc}`,
      color: "#00ff41", category: "social",
    },
    {
      label: "DuckDuckGo",
      description: "Privacy-focused engine",
      url: `https://duckduckgo.com/?q=${enc}`,
      color: "#00ff41", category: "social",
    },
    // ── Domain intelligence ───────────────────────────────────────────────────
    {
      label: "MXToolbox",
      description: "MX records, SPF, DKIM, DMARC — email infrastructure",
      url: `https://mxtoolbox.com/domain/${encDomain}`,
      color: "#888", category: "domain",
    },
    {
      label: "WHOIS Lookup",
      description: "Domain registration, registrar, owner contact",
      url: `https://www.whois.com/whois/${encDomain}`,
      color: "#888", category: "domain",
    },
    {
      label: "ViewDNS",
      description: "Reverse IP, DNS history, email server info",
      url: `https://viewdns.info/reversewhois/?q=${encDomain}`,
      color: "#888", category: "domain",
    },
    {
      label: "Spamhaus Domain",
      description: "Check if email domain is on spam blacklists",
      url: `https://check.spamhaus.org/domain/${encDomain}`,
      color: "#888", category: "domain",
    },
    {
      label: "SecurityTrails",
      description: "Historical DNS, subdomains, IP history for domain",
      url: `https://securitytrails.com/domain/${encDomain}/history/a`,
      color: "#888", category: "domain",
    },
    {
      label: "Shodan Domain",
      description: "Exposed services and infrastructure for domain",
      url: `https://www.shodan.io/search?query=hostname%3A${encDomain}`,
      color: "#888", category: "domain",
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
  const links = buildLinks(email, domain);
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: links.filter((l) => l.category === cat),
  }));

  return (
    <div className="terminal-card p-4 space-y-4">
      <div className="text-xs uppercase tracking-widest text-[#00ff41]/50 border-b border-[#00ff41]/15 pb-2">
        [ EMAIL OSINT MATRIX ] — {links.length} investigation targets
      </div>
      <div className="text-[13px] text-[#00ff41]/50 italic">
        Opens in new tab. Use only within your authorized scope.
      </div>

      {/* Every category in CATEGORY_ORDER is always populated by buildLinks, so
          there is no empty-group case to guard here. */}
      {byCategory.map(({ cat, items }) => (
          <div key={cat} className="space-y-1.5">
            <div
              className="text-[12px] uppercase tracking-widest font-mono pb-0.5"
              style={{ color: CATEGORY_META[cat].color + "60" }}
            >
              — {CATEGORY_META[cat].label} —
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {items.map((link) => (
                <a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 p-2.5 border border-[#00ff41]/10 hover:border-[#00ff41]/35 hover:bg-[#00ff41]/[0.04] transition-all"
                >
                  <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" style={{ color: link.color }} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: link.color }}>
                      {link.label}
                    </div>
                    <div className="text-[12px] text-[#00ff41]/55 mt-0.5 leading-tight line-clamp-2">
                      {link.description}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
      ))}
    </div>
  );
}
