"use client";

import { useMemo } from "react";
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
  category: string;
  usOnly?: boolean;
}

function buildLinks(e164: string, national: string, country: string): PivotLink[] {
  const encoded = encodeURIComponent(e164);
  const encodedNational = encodeURIComponent(national);
  const digits = e164.replace(/\D/g, "");
  const cc = country.toLowerCase();

  return [
    // ── Identity / Reverse lookup ──────────────────────────────────────────────
    {
      label: "Truecaller",
      description: "Global crowd-sourced caller ID & spam reports — largest database",
      url: `https://www.truecaller.com/search/${cc}/${encodedNational}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "Sync.me",
      description: "Global reverse phone lookup with social profile linking",
      url: `https://sync.me/search/?number=${encoded}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "NumLookup",
      description: "Free carrier + CNAM lookup — good for US numbers",
      url: `https://www.numlookup.com/?number=${encoded}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "TruePeopleSearch",
      description: "Full name, address, relatives — US numbers",
      url: `https://www.truepeoplesearch.com/find/person?phoneno=${digits}`,
      color: "#00d9ff",
      category: "identity",
      usOnly: true,
    },
    {
      label: "FastPeopleSearch",
      description: "US reverse lookup — name, address, age, relatives",
      url: `https://www.fastpeoplesearch.com/phone/${digits}`,
      color: "#00d9ff",
      category: "identity",
      usOnly: true,
    },
    {
      label: "USPhoneBook",
      description: "US landline & mobile reverse lookup",
      url: `https://www.usphonebook.com/${digits}`,
      color: "#00d9ff",
      category: "identity",
      usOnly: true,
    },
    {
      label: "That's Them",
      description: "US people search by phone — returns full profiles",
      url: `https://thatsthem.com/phone/${digits}`,
      color: "#00d9ff",
      category: "identity",
      usOnly: true,
    },
    {
      label: "Spy Dialer",
      description: "Free reverse phone — sometimes returns voicemail snippet",
      url: `https://spydialer.com/default.aspx?phone=${digits}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "CallerSmart",
      description: "Caller ID community-reported names",
      url: `https://www.callersmart.com/phone-number/${digits}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "AnyWho",
      description: "AT&T-backed US reverse directory",
      url: `https://www.anywho.com/reverse-phone-lookup/${digits}`,
      color: "#00d9ff",
      category: "identity",
      usOnly: true,
    },
    {
      label: "Infobel",
      description: "International directory — 60+ countries",
      url: `https://www.infobel.com/en/world/search/?q=${encodedNational}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "PhoneBook.com",
      description: "Global reverse lookup database",
      url: `https://www.phonebook.com/phone/${digits}/`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "Whitepages",
      description: "US & Canada reverse lookup — name, address, relatives, background",
      url: `https://www.whitepages.com/phone/${digits}`,
      color: "#00d9ff",
      category: "identity",
      usOnly: true,
    },
    {
      label: "Spokeo",
      description: "US people search aggregator — social, address, email correlation",
      url: `https://www.spokeo.com/phone-number-lookup/${digits}`,
      color: "#00d9ff",
      category: "identity",
      usOnly: true,
    },
    {
      label: "BeenVerified",
      description: "US background & reverse phone — name, criminal, social links",
      url: `https://www.beenverified.com/phone/${digits}`,
      color: "#00d9ff",
      category: "identity",
      usOnly: true,
    },
    {
      label: "Intelius",
      description: "US deep background — identity, address history, associates",
      url: `https://www.intelius.com/reverse-phone-lookup/${digits}/`,
      color: "#00d9ff",
      category: "identity",
      usOnly: true,
    },
    {
      label: "ZabaSearch",
      description: "US free people-search aggregator — name + address pivot",
      url: `https://www.zabasearch.com/phone/${digits}/`,
      color: "#00d9ff",
      category: "identity",
      usOnly: true,
    },
    {
      label: "PeekYou",
      description: "Social identity aggregator — links phone to online profiles",
      url: `https://www.peekyou.com/phone/${digits}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "NumVerify",
      description: "REST phone validation — carrier, line type, location (free tier)",
      url: `https://numverify.com/`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "Pipl Search",
      description: "Deep-web people search — indexes non-crawled public records",
      url: `https://pipl.com/search/?q=${encoded}`,
      color: "#00d9ff",
      category: "identity",
    },
    {
      label: "Radaris",
      description: "US + international background — address, relatives, associates",
      url: `https://radaris.com/p/${digits}`,
      color: "#00d9ff",
      category: "identity",
    },

    // ── Messaging platforms — check if registered ──────────────────────────────
    {
      label: "WhatsApp",
      description: "Open chat — if registered, it works immediately. 2B+ users.",
      url: `https://wa.me/${digits}`,
      color: "#25D366",
      category: "messaging",
    },
    {
      label: "Telegram",
      description: "Open Telegram chat — reveals if number is registered",
      url: `https://t.me/+${digits}`,
      color: "#2AABEE",
      category: "messaging",
    },
    {
      label: "Signal",
      description: "Signal link — works only if recipient has Signal installed",
      url: `https://signal.me/#p/${encoded}`,
      color: "#3A76F0",
      category: "messaging",
    },
    {
      label: "Viber",
      description: "Viber deep-link — opens chat if registered",
      url: `viber://chat?number=${digits}`,
      color: "#7360f2",
      category: "messaging",
    },
    {
      label: "iMessage Check",
      description: "On macOS/iOS — open Messages and type number to check delivery type",
      url: `sms:${e164}`,
      color: "#34C759",
      category: "messaging",
    },
    {
      label: "Line",
      description: "Line messenger — popular in Japan, Thailand, Taiwan, Indonesia",
      url: `https://line.me/ti/p/${encoded}`,
      color: "#00C300",
      category: "messaging",
    },
    {
      label: "KakaoTalk",
      description: "Korea's dominant messaging app — check via chat link",
      url: `https://open.kakao.com/o/s${digits}`,
      color: "#FAE100",
      category: "messaging",
    },
    {
      label: "WeChat",
      description: "Dominant in China — search phone number inside WeChat app",
      url: `https://web.wechat.com/`,
      color: "#7BB32E",
      category: "messaging",
    },

    // ── Intelligence platforms ─────────────────────────────────────────────────
    {
      label: "IntelligenceX",
      description: "Deep web + breach + darknet search — phone number as selector",
      url: `https://intelx.io/?s=${encoded}`,
      color: "#ff3e3e",
      category: "intel",
    },
    {
      label: "Dehashed",
      description: "Breach database — find email/password combos tied to this number",
      url: `https://dehashed.com/search?query=${encoded}`,
      color: "#ff3e3e",
      category: "intel",
    },
    {
      label: "Epieos",
      description: "Phone → associated email + social profile correlation",
      url: `https://epieos.com/?q=${encoded}&t=phone`,
      color: "#ff3e3e",
      category: "intel",
    },
    {
      label: "HaveIBeenPwned",
      description: "Check if phone appeared in known data breaches",
      url: `https://haveibeenpwned.com/`,
      color: "#ff3e3e",
      category: "intel",
    },
    {
      label: "LeakCheck",
      description: "Breach search — password, email, name linked to number",
      url: `https://leakcheck.io/?query=${encoded}`,
      color: "#ff3e3e",
      category: "intel",
    },
    {
      label: "Snusbase",
      description: "Large breach database search — phone, email, username pivot",
      url: `https://snusbase.com/`,
      color: "#ff3e3e",
      category: "intel",
    },
    {
      label: "BreachDirectory",
      description: "Open breach search API — email/phone to password hash lookup",
      url: `https://breachdirectory.org/`,
      color: "#ff3e3e",
      category: "intel",
    },
    {
      label: "SpyCloud",
      description: "Enterprise breach clearinghouse — recaptured ATO data",
      url: `https://spycloud.com/check-your-exposure/`,
      color: "#ff3e3e",
      category: "intel",
    },
    {
      label: "GhostProject",
      description: "Fast breach DB — email pivot. Cross-reference number via email",
      url: `https://ghostproject.fr/`,
      color: "#ff3e3e",
      category: "intel",
    },

    // ── Social / Open web ──────────────────────────────────────────────────────
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
      label: "Google: Twitter/X",
      description: `site:twitter.com "${e164}"`,
      url: `https://www.google.com/search?q=site:twitter.com+%22${encoded}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google: GitHub",
      description: `site:github.com "${e164}" — code repos, gists, issues`,
      url: `https://www.google.com/search?q=site:github.com+%22${encoded}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google: Pastebin",
      description: `site:pastebin.com "${e164}" — leaked credentials`,
      url: `https://www.google.com/search?q=site:pastebin.com+%22${encoded}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google Broad Dork",
      description: `"${e164}" OR "${national}" — all public web`,
      url: `https://www.google.com/search?q=%22${encoded}%22+OR+%22${encodedNational}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Bing Search",
      description: "Bing indexes different content than Google — always worth checking",
      url: `https://www.bing.com/search?q=%22${encoded}%22+OR+%22${encodedNational}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google Maps",
      description: "Find businesses or contacts linked to this number",
      url: `https://www.google.com/maps/search/${encodedNational}`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "DuckDuckGo",
      description: "Privacy-focused engine — sometimes shows results Google suppresses",
      url: `https://duckduckgo.com/?q=%22${encoded}%22+OR+%22${encodedNational}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Yandex Search",
      description: "Russian engine — excellent for Eastern Europe, MENA, CIS numbers",
      url: `https://yandex.com/search/?text=${encoded}`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google: Reddit",
      description: `site:reddit.com "${e164}" — forum posts, threads`,
      url: `https://www.google.com/search?q=site:reddit.com+%22${encoded}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google: TikTok",
      description: `site:tiktok.com "${national}" — profile bios`,
      url: `https://www.google.com/search?q=site:tiktok.com+%22${encodedNational}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google: YouTube",
      description: `site:youtube.com "${national}" — channel About pages`,
      url: `https://www.google.com/search?q=site:youtube.com+%22${encodedNational}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Google: Yelp",
      description: `site:yelp.com "${national}" — business listings`,
      url: `https://www.google.com/search?q=site:yelp.com+%22${encodedNational}%22`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Wayback Machine",
      description: "Archived web snapshots — number may appear in deleted pages",
      url: `https://web.archive.org/web/*/${encoded}`,
      color: "#00ff41",
      category: "social",
    },
    {
      label: "Baidu Search",
      description: "China's search engine — critical for CN/HK/TW numbers",
      url: `https://www.baidu.com/s?wd=${encoded}`,
      color: "#00ff41",
      category: "social",
    },

    // ── Spam / Abuse reports ───────────────────────────────────────────────────
    {
      label: "800notes",
      description: "Community spam call reports — US focused",
      url: `https://800notes.com/Phone.aspx/${digits}`,
      color: "#ff8800",
      category: "spam",
    },
    {
      label: "Should I Answer",
      description: "Global spam & scam call ratings with user comments",
      url: `https://www.shouldianswer.com/phone-number/${digits}`,
      color: "#ff8800",
      category: "spam",
    },
    {
      label: "Who Called Me",
      description: "International spam call database",
      url: `https://www.whocalledme.com/PhoneNumber/${digits}`,
      color: "#ff8800",
      category: "spam",
    },
    {
      label: "CallerReport",
      description: "Crowdsourced caller database — reports & comments",
      url: `https://callerreport.com/${digits}`,
      color: "#ff8800",
      category: "spam",
    },
    {
      label: "SpamCalls.net",
      description: "European-focused spam call directory",
      url: `https://www.spamcalls.net/en/search?query=${digits}`,
      color: "#ff8800",
      category: "spam",
    },
    {
      label: "WhoCalledUs",
      description: "UK-focused spam reporting database",
      url: `https://www.whocalledus.com/${digits}`,
      color: "#ff8800",
      category: "spam",
    },
    {
      label: "CallTruth",
      description: "US number reputation — spam score, complaint history",
      url: `https://www.calltruth.com/call/${digits}`,
      color: "#ff8800",
      category: "spam",
    },
    {
      label: "PhoneSpamFilter",
      description: "Real-time spam classification for phone numbers",
      url: `https://phonespamfilter.com/`,
      color: "#ff8800",
      category: "spam",
    },
    {
      label: "Nomorobo",
      description: "Robocall / telemarketer database — checks known STIR/SHAKEN flags",
      url: `https://www.nomorobo.com/lookup/${digits}`,
      color: "#ff8800",
      category: "spam",
    },
    {
      label: "IPQS Reputation",
      description: "IP Quality Score — fraud score, VoIP flag, carrier, activity",
      url: `https://www.ipqualityscore.com/free-ip-lookup-proxy-vpn-test/lookup/${encoded}`,
      color: "#ff8800",
      category: "spam",
    },

    // ── Carrier / HLR / Telecom ────────────────────────────────────────────────
    {
      label: "FreeCarrierLookup",
      description: "Free carrier lookup — confirms current carrier of number",
      url: `https://freecarrierlookup.com/`,
      color: "#888",
      category: "carrier",
    },
    {
      label: "PhoneValidator",
      description: "Line type + carrier validator",
      url: `https://www.phonevalidator.com/index.aspx?phone=${encodedNational}`,
      color: "#888",
      category: "carrier",
    },
    {
      label: "HLR-Lookups",
      description: "Real-time HLR — is number active? What network? Roaming? (paid, free trial)",
      url: `https://www.hlr-lookups.com/`,
      color: "#888",
      category: "carrier",
    },
    {
      label: "TextMagic Validator",
      description: "Free online validator — line type, carrier, country",
      url: `https://www.textmagic.com/free-tools/phone-validator`,
      color: "#888",
      category: "carrier",
    },
    {
      label: "MNP API (portability)",
      description: "Check if number has been ported to a different carrier",
      url: `https://www.mnpchecker.com/`,
      color: "#888",
      category: "carrier",
    },
    {
      label: "OpenCNAM",
      description: "CNAM lookup API — caller name from PSTN database (free tier)",
      url: `https://www.opencnam.com/`,
      color: "#888",
      category: "carrier",
    },
    {
      label: "Twilio Lookup Demo",
      description: "Twilio Lookup API demo — line type, carrier, caller name",
      url: `https://www.twilio.com/lookup`,
      color: "#888",
      category: "carrier",
    },
    {
      label: "Plivo Lookup",
      description: "Plivo phone number lookup — carrier, type, country",
      url: `https://console.plivo.com/phone-numbers/lookup/`,
      color: "#888",
      category: "carrier",
    },
    {
      label: "Vonage Number Insight",
      description: "Real-time number type, carrier, validity check",
      url: `https://www.vonage.com/communications-apis/number-insight/`,
      color: "#888",
      category: "carrier",
    },
    {
      label: "NumInfo",
      description: "Free phone number info — format, country, type",
      url: `https://www.phoneinfoga.cz/`,
      color: "#888",
      category: "carrier",
    },
  ];
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  identity:  { label: "IDENTITY / REVERSE LOOKUP",     color: "#00d9ff" },
  messaging: { label: "MESSAGING PLATFORMS — IS IT REGISTERED?", color: "#25D366" },
  intel:     { label: "INTELLIGENCE PLATFORMS / BREACH DATA",    color: "#ff3e3e" },
  social:    { label: "SOCIAL / OPEN WEB DORKS",        color: "#00ff41" },
  spam:      { label: "SPAM / ABUSE REPORTS",           color: "#ff8800" },
  carrier:   { label: "CARRIER / HLR / TELECOM",        color: "#888" },
};

const CATEGORY_ORDER = ["identity", "messaging", "intel", "social", "spam", "carrier"] as const;

export default function OsintPivots({ e164, national, country = "us" }: Props) {
  const { links, byCategory } = useMemo(() => {
    const links = buildLinks(e164, national, country);
    const grouped = links.reduce<Record<string, PivotLink[]>>((acc, l) => {
      (acc[l.category] ??= []).push(l);
      return acc;
    }, {});
    const byCategory = CATEGORY_ORDER.map((cat) => ({ cat, items: grouped[cat] ?? [] }));
    return { links, byCategory };
  }, [e164, national, country]);

  return (
    <div className="terminal-card p-4 space-y-4">
      <div className="flex items-center justify-between border-b border-[#00ff41]/15 pb-2">
        <div className="text-xs uppercase tracking-widest text-[#00ff41]/50">
          [ OSINT PIVOT MATRIX ] — {links.length} investigation targets
        </div>
      </div>
      <div className="text-[13px] text-[#00ff41]/25 italic">
        Opens in new tab. Use only within your authorized scope.
      </div>

      {byCategory.map(({ cat, items }) =>
        items.length === 0 ? null : (
          <div key={cat} className="space-y-1.5">
            <div
              className="text-[12px] uppercase tracking-widest font-mono pb-0.5"
              style={{ color: CATEGORY_META[cat].color + "60" }}
            >
              — {CATEGORY_META[cat].label} — ({items.length})
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
                      {link.usOnly && (
                        <span className="ml-1 text-[11px] text-[#00ff41]/25 font-normal">[US]</span>
                      )}
                    </div>
                    <div className="text-[12px] text-[#00ff41]/55 mt-0.5 leading-tight line-clamp-2">
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
