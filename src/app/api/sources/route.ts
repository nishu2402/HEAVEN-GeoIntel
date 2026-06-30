import { NextResponse } from "next/server";
import { configuredMap } from "@/lib/keyStore";

// Reports which data sources are active and which optional API keys are
// configured — and HOW (added in the app vs. via .env). Never returns key
// values. `keys` lists the env-var name(s) each key source needs, so the
// settings UI can manage them.

export const dynamic = "force-dynamic";

interface SourceInfo {
  id: string;
  name: string;
  tier: "free" | "key";
  configured: boolean;
  via?: "ui" | "env" | null;
  keys?: string[];
  unlocks: string;
  modes: string[];
  signup?: string;
}

export async function GET(): Promise<NextResponse> {
  const cfg = await configuredMap();
  const isSet = (k: keyof typeof cfg) => cfg[k] !== null;
  // For multi-key sources (Twilio), surface the "weakest" provenance.
  const via = (...names: (keyof typeof cfg)[]): "ui" | "env" | null => {
    if (names.some((n) => cfg[n] === null)) return null;
    return names.some((n) => cfg[n] === "ui") ? "ui" : "env";
  };

  const sources: SourceInfo[] = [
    // ── Always free, no key required ──
    { id: "hudsonrock", name: "Hudson Rock", tier: "free", configured: true, unlocks: "Infostealer-malware exposure (phone + email)", modes: ["phone", "email"] },
    { id: "xposedornot", name: "XposedOrNot", tier: "free", configured: true, unlocks: "Email breach database — 1000+ sources", modes: ["email"] },
    { id: "gravatar", name: "Gravatar", tier: "free", configured: true, unlocks: "Public profile + linked accounts for an email", modes: ["email"] },
    { id: "ipapi", name: "ip-api + Shodan InternetDB", tier: "free", configured: true, unlocks: "IP geo · ASN · ISP · ports · proxy/hosting flags", modes: ["ip"] },
    { id: "doh", name: "Cloudflare DoH · RDAP · crt.sh", tier: "free", configured: true, unlocks: "DNS · WHOIS · subdomains for a domain", modes: ["domain"] },
    { id: "usernames", name: "44-site username sweep", tier: "free", configured: true, unlocks: "Where a handle is registered", modes: ["username"] },

    // ── Optional keys (add in the app, or via .env.local) ──
    { id: "ipqs", name: "IPQualityScore", tier: "key", configured: isSet("IPQS_API_KEY"), via: cfg.IPQS_API_KEY, keys: ["IPQS_API_KEY"], unlocks: "Fraud score · VoIP · prepaid · active · city", modes: ["phone"], signup: "https://www.ipqualityscore.com" },
    { id: "numverify", name: "NumVerify", tier: "key", configured: isSet("NUMVERIFY_API_KEY"), via: cfg.NUMVERIFY_API_KEY, keys: ["NUMVERIFY_API_KEY"], unlocks: "Carrier + line type", modes: ["phone"], signup: "https://numverify.com" },
    { id: "twilio", name: "Twilio Lookup", tier: "key", configured: isSet("TWILIO_ACCOUNT_SID") && isSet("TWILIO_AUTH_TOKEN"), via: via("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"), keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], unlocks: "Carrier · CNAM owner · MCC/MNC", modes: ["phone"], signup: "https://www.twilio.com" },
    { id: "abstract", name: "AbstractAPI", tier: "key", configured: isSet("ABSTRACT_API_KEY"), via: cfg.ABSTRACT_API_KEY, keys: ["ABSTRACT_API_KEY"], unlocks: "Phone + email validation (SMTP/MX)", modes: ["phone", "email"], signup: "https://www.abstractapi.com" },
    { id: "hunter", name: "Hunter.io", tier: "key", configured: isSet("HUNTER_API_KEY"), via: cfg.HUNTER_API_KEY, keys: ["HUNTER_API_KEY"], unlocks: "Email deliverability + confidence", modes: ["email"], signup: "https://hunter.io" },
    { id: "emailrep", name: "EmailRep.io", tier: "key", configured: isSet("EMAILREP_API_KEY"), via: cfg.EMAILREP_API_KEY, keys: ["EMAILREP_API_KEY"], unlocks: "Reputation + breach flags (also works with no key)", modes: ["email"], signup: "https://emailrep.io" },
    { id: "fullcontact", name: "FullContact", tier: "key", configured: isSet("FULLCONTACT_API_KEY"), via: cfg.FULLCONTACT_API_KEY, keys: ["FULLCONTACT_API_KEY"], unlocks: "Real name · employer · social profiles", modes: ["phone", "email"], signup: "https://www.fullcontact.com" },
    { id: "rapidapi", name: "BreachDirectory (RapidAPI)", tier: "key", configured: isSet("RAPIDAPI_KEY"), via: cfg.RAPIDAPI_KEY, keys: ["RAPIDAPI_KEY"], unlocks: "Real credential hashes (phone + email)", modes: ["phone", "email"], signup: "https://rapidapi.com/rohan-patra/api/breachdirectory" },
  ];

  const keyTotal = sources.filter((s) => s.tier === "key").length;
  const keyActive = sources.filter((s) => s.tier === "key" && s.configured).length;

  return NextResponse.json({ sources, keyTotal, keyActive }, { headers: { "Cache-Control": "no-store" } });
}
