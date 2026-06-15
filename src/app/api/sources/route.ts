import { NextResponse } from "next/server";

// Reports which data sources are active and which optional API keys are
// configured — booleans ONLY, never the key values. Lets the UI explain why a
// field is empty ("source not configured") instead of leaving the user guessing.

export const dynamic = "force-dynamic";

interface SourceInfo {
  id: string;
  name: string;
  tier: "free" | "key";
  configured: boolean;
  unlocks: string;
  modes: string[];
  signup?: string;
}

export async function GET(): Promise<NextResponse> {
  const has = (k: string) => Boolean(process.env[k]);

  const sources: SourceInfo[] = [
    // ── Always free, no key required ──
    { id: "hudsonrock", name: "Hudson Rock", tier: "free", configured: true, unlocks: "Infostealer-malware exposure (phone + email)", modes: ["phone", "email"] },
    { id: "xposedornot", name: "XposedOrNot", tier: "free", configured: true, unlocks: "Email breach database — 1000+ sources", modes: ["email"] },
    { id: "gravatar", name: "Gravatar", tier: "free", configured: true, unlocks: "Public profile + linked accounts for an email", modes: ["email"] },
    { id: "ipapi", name: "ip-api + Shodan InternetDB", tier: "free", configured: true, unlocks: "IP geo · ASN · ISP · ports · proxy/hosting flags", modes: ["ip"] },
    { id: "doh", name: "Cloudflare DoH · RDAP · crt.sh", tier: "free", configured: true, unlocks: "DNS · WHOIS · subdomains for a domain", modes: ["domain"] },
    { id: "usernames", name: "44-site username sweep", tier: "free", configured: true, unlocks: "Where a handle is registered", modes: ["username"] },

    // ── Optional keys (add to .env.local) ──
    { id: "ipqs", name: "IPQualityScore", tier: "key", configured: has("IPQS_API_KEY"), unlocks: "Fraud score · VoIP · prepaid · active · city", modes: ["phone"], signup: "https://www.ipqualityscore.com" },
    { id: "numverify", name: "NumVerify", tier: "key", configured: has("NUMVERIFY_API_KEY"), unlocks: "Carrier + line type", modes: ["phone"], signup: "https://numverify.com" },
    { id: "twilio", name: "Twilio Lookup", tier: "key", configured: has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN"), unlocks: "Carrier · CNAM owner · MCC/MNC", modes: ["phone"], signup: "https://www.twilio.com" },
    { id: "abstract", name: "AbstractAPI", tier: "key", configured: has("ABSTRACT_API_KEY"), unlocks: "Phone + email validation (SMTP/MX)", modes: ["phone", "email"], signup: "https://www.abstractapi.com" },
    { id: "hunter", name: "Hunter.io", tier: "key", configured: has("HUNTER_API_KEY"), unlocks: "Email deliverability + confidence", modes: ["email"], signup: "https://hunter.io" },
    { id: "emailrep", name: "EmailRep.io", tier: "key", configured: has("EMAILREP_API_KEY"), unlocks: "Reputation + breach flags (also works with no key)", modes: ["email"], signup: "https://emailrep.io" },
    { id: "fullcontact", name: "FullContact", tier: "key", configured: has("FULLCONTACT_API_KEY"), unlocks: "Real name · employer · social profiles", modes: ["phone", "email"], signup: "https://www.fullcontact.com" },
    { id: "rapidapi", name: "BreachDirectory (RapidAPI)", tier: "key", configured: has("RAPIDAPI_KEY"), unlocks: "Real credential hashes (phone + email)", modes: ["phone", "email"], signup: "https://rapidapi.com/rohan-patra/api/breachdirectory" },
  ];

  const keyTotal = sources.filter((s) => s.tier === "key").length;
  const keyActive = sources.filter((s) => s.tier === "key" && s.configured).length;

  return NextResponse.json({ sources, keyTotal, keyActive }, { headers: { "Cache-Control": "no-store" } });
}
