// Free, no-API-key intelligence derived from a phone number's structure.
// These functions never call an external API — they only inspect the digits
// and known regional ranges. Everything here works offline.

import type { PhoneAnalysis } from "./phoneAnalysis";

// ── Known VOIP / cloud-telephony number ranges ───────────────────────────
// Numbers in these blocks are almost always allocated to VOIP / cloud
// providers, so we can flag them without an API.
const VOIP_HINTS: { match: (digits: string) => boolean; provider: string }[] = [
  // US Google Voice — typically ported, but common prefixes that ARE GV blocks
  { match: (d) => /^1(669|820|934|878|332|689|351|947|614|762)/.test(d), provider: "Likely VOIP / cloud-allocated US block" },
  // US toll-free
  { match: (d) => /^1(800|833|844|855|866|877|888)/.test(d), provider: "US toll-free" },
  // UK Skype / VOIP allocations 056
  { match: (d) => /^4456/.test(d),  provider: "UK VOIP allocation (056)" },
  // Generic premium-rate prefixes
  { match: (d) => /^1900/.test(d),  provider: "US premium rate" },
  { match: (d) => /^4490/.test(d),  provider: "UK premium rate (09)" },
];

// India: leading digit of the 10-digit mobile number identifies the operator group
// Source: TRAI National Numbering Plan. These are starting digits AFTER the +91 country code.
const INDIA_MOBILE_GROUPS: { prefix: RegExp; carrier: string }[] = [
  { prefix: /^9[0-9]/,    carrier: "Jio / Airtel / Vi (mixed pool: 9-series)" },
  { prefix: /^8[0-9]/,    carrier: "Mixed operators (8-series)" },
  { prefix: /^7[0-9]/,    carrier: "Mixed operators (7-series)" },
  { prefix: /^6[0-9]/,    carrier: "Newer allocations (6-series, mostly Jio)" },
];

// US/CA NPA → owner type hint (when not in NPA database).  Useful for showing
// "looks like a non-geographic number" without calling an API.
function inferUsTypeHint(npa: string): string | null {
  if (["500", "521", "522", "523", "524", "525", "526", "527", "528", "529", "532", "533", "535", "538", "542", "544", "545", "566", "577", "588"].includes(npa))
    return "US personal communications service (non-geographic)";
  if (npa === "900") return "US premium-rate (caller pays)";
  return null;
}

export interface OfflineReputation {
  // Confidence the number is a real, dialable subscriber line.
  confidence: "high" | "medium" | "low";
  // Inferred carrier label (best-effort, never claims more than we know).
  inferredCarrier: string | null;
  // Free-form notes the UI shows as small badges.
  signals: string[];
}

export function deriveOfflineReputation(analysis: PhoneAnalysis): OfflineReputation {
  const digits = analysis.e164.replace(/\D/g, "");
  const signals: string[] = [];
  let inferredCarrier: string | null = null;

  // VOIP / premium-rate hints
  for (const hint of VOIP_HINTS) {
    if (hint.match(digits)) {
      signals.push(hint.provider);
      inferredCarrier = hint.provider; // first match wins: we break immediately
      break;
    }
  }

  // India carrier group hint. `subscriberNumber` is now the national
  // significant number, so the trunk "0" this used to strip by hand is already
  // gone — see the derivation in phoneAnalysis.
  if (analysis.country === "IN" && analysis.subscriberNumber) {
    const group = INDIA_MOBILE_GROUPS.find((g) => g.prefix.test(analysis.subscriberNumber));
    if (group) {
      inferredCarrier = group.carrier;
      signals.push(`Group: ${group.carrier}`);
    }
  }

  // US/CA NPA hint when not in our local DB
  if ((analysis.country === "US" || analysis.country === "CA") && !analysis.npaInfo && analysis.areaCode) {
    const hint = inferUsTypeHint(analysis.areaCode);
    if (hint) {
      signals.push(hint);
      inferredCarrier = hint;
    }
  }

  // Confidence — based on what offline analysis can confirm
  let confidence: OfflineReputation["confidence"] = "medium";
  if (analysis.isValid && (analysis.npaInfo || analysis.country)) confidence = "high";
  if (!analysis.isValid || !analysis.country) confidence = "low";

  return { confidence, inferredCarrier, signals };
}
