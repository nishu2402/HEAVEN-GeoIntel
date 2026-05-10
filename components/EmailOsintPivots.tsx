"use client";

import { ExternalLink } from "lucide-react";

interface Props {
  email: string;
  domain: string;
  username: string;
}

interface PivotLink {
  label: string;
  description: string;
  url: string;
  color: string;
  category: string;
}

function buildLinks(email: string, domain: string, username: string): PivotLink[] {
  const enc = encodeURIComponent(email);
  const encDomain = encodeURIComponent(domain);
  const encUser = encodeURIComponent(username);

  return [
    // ── Breach / Data exposure ────────────────────────────────────────────────
    {
      label: "HaveIBeenPwned",
      description: "Check which data breaches exposed this email",
      url: `https://haveibeenpwned.com/account/${enc}`,
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
      url: `https://snusbase.com/?term=${enc}&type=email`,
      color: "#ff3e3e", category: "breach",
    },
    {
      label: "BreachDirectory",
      description: "Free breach search with password hash exposure",
      url: `https://breachdirectory.org/?query=${enc}`,
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
      label: "Gravatar",
      description: "Check avatar profile — often contains name + linked accounts",
      url: `https://gravatar.com/${encUser}`,
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
      description: "Global people search by email",
      url: `https://pipl.com/search/?q=${enc}&l=&sloc=&in=5`,
      color: "#00d9ff", category: "identity",
    },
    // ── Social media ──────────────────────────────────────────────────────────
    {
      label: "Google: LinkedIn",
      description: `site:linkedin.com "${email}"`,
      url: `https://www.google.com/search?q=site:linkedin.com+%22${enc}%22`,
      color: "#00ff41", category: "social",
    },
    {
      label: "Google: Twitter/X",
      description: `site:twitter.com "${email}"`,
      url: `https://www.google.com/search?q=site:twitter.com+%22${enc}%22`,
      color: "#00ff41", category: "social",
    },
    {
      label: "Google: Facebook",
      description: `site:facebook.com "${email}"`,
      url: `https://www.google.com/search?q=site:facebook.com+%22${enc}%22`,
      color: "#00ff41", category: "social",
    },
    {
      label: "Google: GitHub",
      description: `site:github.com "${email}" — code, commits, gists`,
      url: `https://www.google.com/search?q=site:github.com+%22${enc}%22`,
      color: "#00ff41", category: "social",
    },
    {
      label: "GitHub Email Search",
      description: "Find commits with this email in author field",
      url: `https://github.com/search?q=${enc}&type=commits`,
      color: "#00ff41", category: "social",
    },
    {
      label: "Google Broad",
      description: `"${email}" — all indexed web results`,
      url: `https://www.google.com/search?q=%22${enc}%22`,
      color: "#00ff41", category: "social",
    },
    {
      label: "Bing Search",
      description: "Bing indexes different data — cross-reference results",
      url: `https://www.bing.com/search?q=%22${enc}%22`,
      color: "#00ff41", category: "social",
    },
    {
      label: "Pastebin Leak",
      description: `site:pastebin.com "${email}"`,
      url: `https://www.google.com/search?q=site:pastebin.com+%22${enc}%22`,
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

export default function EmailOsintPivots({ email, domain, username }: Props) {
  const links = buildLinks(email, domain, username);
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: links.filter((l) => l.category === cat),
  }));

  return (
    <div className="terminal-card p-4 space-y-4">
      <div className="text-xs uppercase tracking-widest text-[#00ff41]/50 border-b border-[#00ff41]/15 pb-2">
        [ EMAIL OSINT MATRIX ] — {links.length} investigation targets
      </div>
      <div className="text-[10px] text-[#00ff41]/25 italic">
        Opens in new tab. Use only within your authorized scope.
      </div>

      {byCategory.map(({ cat, items }) =>
        items.length === 0 ? null : (
          <div key={cat} className="space-y-1.5">
            <div
              className="text-[9px] uppercase tracking-widest font-mono pb-0.5"
              style={{ color: (CATEGORY_META[cat]?.color ?? "#00ff41") + "60" }}
            >
              — {CATEGORY_META[cat]?.label ?? cat} —
            </div>
            <div className="grid grid-cols-2 gap-1.5">
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
                    <div className="text-[9px] text-[#00ff41]/30 mt-0.5 leading-tight line-clamp-2">
                      {link.description}
                    </div>
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
